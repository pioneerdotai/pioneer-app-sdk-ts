import { WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import { failure, hostFailure, PioneerError } from "../error.js";
import type { Bootstrap } from "./config.js";
import { decodeHeads } from "./output.js";
import type { PtyHead } from "./output.js";

export interface OperationOptions { signal?: AbortSignal }
export class Transport {
  #host: Bootstrap["host_api"];
  #socket: WebSocket | null = null;
  #opening: Promise<WebSocket> | null = null;
  #closed: PioneerError | null = null;
  #waiting = 0;
  #generation = 0;
  #pending = new Map<string, { socket: WebSocket; reject(error: PioneerError): void; resolve(value: unknown): void }>();
  readonly outputs = new Map<string, (value: unknown) => void>();
  readonly changes = new Map<string, (head: PtyHead) => void>();
  readonly disconnects = new Set<() => void>();
  constructor(host: Bootstrap["host_api"]) { this.#host = host; }
  async #connect(): Promise<WebSocket> {
    if (this.#closed) throw this.#closed;
    if (!this.#host?.capabilities.includes("host.pty")) throw failure("sdk.capability_unavailable");
    if (this.#socket?.readyState === WebSocket.OPEN) return this.#socket;
    if (this.#opening) return this.#opening;
    const host = this.#host;
    const opening = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(host.endpoint, {
        headers: { Authorization: `Bearer ${host.credential}` },
        maxPayload: 128 * 1024, handshakeTimeout: 10000, followRedirects: false,
      });
      this.#socket = socket;
      let disconnected = false;
      const gone = () => {
        if (disconnected) return;
        disconnected = true;
        const current = this.#socket === socket;
        if (current) { this.#socket = null; this.#generation++; }
        reject(this.#closed ?? failure("sdk.disconnected"));
        for (const call of [...this.#pending.values()]) {
          if (call.socket === socket) call.reject(this.#closed ?? failure("sdk.delivery_unknown"));
        }
        if (current && !this.#closed) queueMicrotask(() => { for (const listener of this.disconnects) listener(); });
      };
      socket.once("open", () => {
        if (this.#closed || this.#socket !== socket) { socket.terminate(); return; }
        resolve(socket);
      });
      socket.on("error", () => { gone(); socket.terminate(); });
      socket.on("close", gone);
      socket.on("unexpected-response", (_request, response) => {
        response.resume();
        if (response.statusCode === 401 || response.statusCode === 403) this.close(hostFailure("host.revoked"));
        else { gone(); socket.terminate(); }
      });
      socket.on("message", raw => {
        if (this.#closed || this.#socket !== socket) return;
        try {
          const m = JSON.parse(raw.toString());
          if (m.jsonrpc !== "2.0") throw new Error();
          if (typeof m.id === "string") {
            const call = this.#pending.get(m.id);
            if (!call || call.socket !== socket) return;
            if (m.error) {
              const error = hostFailure(m.error.message, typeof m.error.code === "number" ? m.error.code : undefined);
              call.reject(error);
              if (error.code === "host.revoked") this.close(error);
            } else if (Object.hasOwn(m, "result")) call.resolve(m.result);
            else throw new Error();
          } else if (m.method === "host.pty.output") {
            if (!m.params || typeof m.params.session_id !== "string") throw new Error();
            this.outputs.get(m.params.session_id)?.(m.params);
          } else if (m.method === "host.pty.changed") {
            for (const { id, head } of decodeHeads(m.params)) this.changes.get(id)?.(head);
          }
        } catch { this.reset(); }
      });
    });
    const tracked = opening.finally(() => { if (this.#opening === tracked) this.#opening = null; });
    this.#opening = tracked;
    return tracked;
  }
  /** No implicit retries: callers must establish operation-specific safety. */
  async call<T>(method: string, params: object, options: OperationOptions = {}, onResult?: (value: T) => void): Promise<T> {
    if (options.signal?.aborted) throw failure("sdk.cancelled");
    if (this.#pending.size + this.#waiting >= 64) throw failure("sdk.capacity");
    this.#waiting++;
    // Connection wait is cancellable without interrupting other callers.
    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const abort = () => { cleanup(); reject(failure("sdk.cancelled")); };
      const cleanup = () => options.signal?.removeEventListener("abort", abort);
      options.signal?.addEventListener("abort", abort, { once: true });
      void this.#connect().then(
        s => { this.#waiting--; cleanup(); resolve(s); },
        () => { this.#waiting--; cleanup(); reject(this.#closed ?? failure("sdk.disconnected")); },
      );
    });
    if (options.signal?.aborted) throw failure("sdk.cancelled");
    if (this.#closed) throw this.#closed;
    if (this.#pending.size >= 64 || socket.bufferedAmount > 128 * 1024) throw failure("sdk.capacity");
    if (this.#socket !== socket || socket.readyState !== WebSocket.OPEN) throw failure("sdk.disconnected");
    return new Promise<T>((resolve, reject) => {
      // RequestId is exactly 21 characters; 126 random bits, unlike UUID's
      // incompatible 36-character representation. Keys/stream IDs are separate.
      let id: string;
      do { id = randomBytes(16).toString("base64url").slice(0, 21); } while (this.#pending.has(id));
      const finish = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); this.#pending.delete(id); };
      // Once sent, cancellation/timeout cannot retract a Gateway operation.
      const abort = () => { finish(); reject(failure("sdk.delivery_unknown")); };
      const timer = setTimeout(() => { finish(); reject(failure("sdk.delivery_unknown")); this.reset(); }, 10000);
      this.#pending.set(id, {
        socket,
        resolve: value => {
          finish();
          // Apply protocol state synchronously before ws delivers another
          // message from the same network read. This is not a consumer ACK.
          try { onResult?.(value as T); resolve(value as T); }
          catch (error) { reject(error instanceof PioneerError ? error : failure("sdk.invalid_response")); }
        },
        reject: error => { finish(); reject(error); },
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        const encoded = JSON.stringify({ jsonrpc: "2.0", id, method, params });
        if (Buffer.byteLength(encoded) > 120 * 1024) {
          finish(); reject(failure("sdk.limit")); return;
        }
        socket.send(encoded, error => {
          if (error) {
            this.#pending.get(id)?.reject(failure("sdk.delivery_unknown"));
            if (this.#socket === socket) this.reset();
          }
        });
      } catch {
        this.#pending.get(id)?.reject(failure("sdk.delivery_unknown"));
        if (this.#socket === socket) this.reset();
      }
    });
  }
  /** Fence immediately; close event may arrive after the replacement opens. */
  reset() {
    const socket = this.#socket;
    this.#socket = null;
    this.#generation++;
    for (const call of [...this.#pending.values()]) if (call.socket === socket) call.reject(failure("sdk.delivery_unknown"));
    socket?.terminate();
    if (!this.#closed) queueMicrotask(() => { for (const listener of this.disconnects) listener(); });
  }
  close(error = failure("sdk.closed")) {
    if (this.#closed) return;
    this.#closed = error;
    for (const call of [...this.#pending.values()]) call.reject(error);
    this.outputs.clear();
    this.changes.clear();
    this.reset();
    for (const listener of this.disconnects) listener();
    this.disconnects.clear();
    this.#host = null;
  }
  get closedError() { return this.#closed; }
  get generation() { return this.#generation; }
}
