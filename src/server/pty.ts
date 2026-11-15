import { randomUUID } from "node:crypto";
import { failure, hostFailure, PioneerError } from "../error.js";
import { Transport } from "./transport.js";
import type { OperationOptions } from "./transport.js";
import { decodeSnapshot } from "./output.js";
import type { PtyHead, PtySnapshot } from "./output.js";

export interface Dimensions { cols: number; rows: number; pixelWidth?: number; pixelHeight?: number }
export interface CreatePtyOptions extends Dimensions, OperationOptions { command?: readonly string[]; cwd?: string }
export interface ReadPtyOptions extends OperationOptions { after: number }
export interface OutputFrame {
  /** Changes on replay/replacement; lets a consumer discard its old queued frames. */
  readonly streamId: string;
  readonly bytes: Uint8Array;
  readonly after: number;
  readonly next: number;
  readonly end: number;
  readonly exitStatus: number | null;
  readonly failed: boolean;
  /** Explicit cumulative consumption. Old connection receipts are fenced. */
  ack(): Promise<void>;
}
export interface SubscribeOptions extends OperationOptions {
  after?: number;
  onOutput(frame: OutputFrame): void;
  onError(error: PioneerError): void;
}
export interface OutputSubscription { readonly cursor: number; dispose(): void }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function dimensions(size: Dimensions) {
  for (const n of [size.cols, size.rows]) if (!integer(n) || n < 1 || n > 1000) throw failure("sdk.invalid_dimensions");
  for (const n of [size.pixelWidth ?? 0, size.pixelHeight ?? 0]) if (!integer(n) || n > 65535) throw failure("sdk.invalid_dimensions");
  return { cols: size.cols, rows: size.rows, pixel_width: size.pixelWidth ?? 0, pixel_height: size.pixelHeight ?? 0 };
}
export class Pty {
  #transport: Transport;
  #sequence: number;
  #blocked = false;
  #closing: Promise<void> | null = null;
  #disposed = false;
  #queue = Promise.resolve();
  #queued = 0;
  #subscription: OutputSubscription | null = null;
  #detachSubscription: (() => void) | null = null;
  #failSubscription: ((error: PioneerError) => void) | null = null;
  #heartbeat: ReturnType<typeof setInterval>;
  #keeping = false;
  #leaseError: PioneerError | null = null;
  #heartbeatAbort = new AbortController();
  #leaseFailures = 0;
  #lastLease = performance.now();
  #onDisconnect: () => void;
  #release: () => void;
  #changeListeners = new Set<(head: PtyHead) => void>();
  private constructor(transport: Transport, readonly id: string, sequence: number, release: () => void) {
    this.#transport = transport;
    this.#sequence = sequence;
    this.#release = release;
    transport.changes.set(id, head => {
      for (const listener of [...this.#changeListeners]) {
        if (this.#disposed || this.#leaseError) break;
        if (!this.#changeListeners.has(listener)) continue;
        try { listener(head); } catch { /* Isolate consumers of legacy hints. */ }
      }
    });
    this.#onDisconnect = () => {
      if (transport.closedError) this.#stopLease(transport.closedError);
    };
    transport.disconnects.add(this.#onDisconnect);
    this.#heartbeat = setInterval(() => {
      if (this.#keeping || this.#disposed || this.#leaseError) return;
      // Leave a full minute before Gateway's five-minute retention deadline.
      if (performance.now() - this.#lastLease >= 240000) {
        this.#stopLease(failure("sdk.lease_unconfirmed")); return;
      }
      this.#keeping = true;
      void this.keepalive({ signal: this.#heartbeatAbort.signal }).catch(error => {
        if (this.#disposed || this.#leaseError) return;
        const transient = error instanceof PioneerError && (error.source === "sdk" ||
          error.code === "host.capacity" || error.code === "host.operation_failed");
        if (!transient) this.#stopLease(error instanceof PioneerError ? error : failure("sdk.lease_unconfirmed"));
        else if (++this.#leaseFailures >= 3) this.#stopLease(failure("sdk.lease_unconfirmed"));
      }).finally(() => { this.#keeping = false; });
    }, 10000);
    this.#heartbeat.unref();
  }
  #stopLease(error: PioneerError) {
    this.#leaseError = error;
    clearInterval(this.#heartbeat);
    this.#heartbeatAbort.abort();
    this.#failSubscription?.(error);
    this.#transport.disconnects.delete(this.#onDisconnect);
    this.#transport.changes.delete(this.id);
    this.#changeListeners.clear();
  }
  static async create(transport: Transport, options: CreatePtyOptions, release: () => void, uncertain: (value: boolean) => void): Promise<Pty> {
    const params = {
      key: randomUUID(), dimensions: dimensions(options),
      ...(options.command === undefined ? {} : { command: [...options.command] }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    };
    if (options.command && (options.command.length === 0 || options.command.length > 128 || options.command.some(s => typeof s !== "string" || !s || Buffer.byteLength(s) > 16384 || s.includes("\0")))) throw failure("sdk.invalid_params");
    if (options.cwd !== undefined && (typeof options.cwd !== "string" || Buffer.byteLength(options.cwd) > 4096 || options.cwd.includes("\0"))) throw failure("sdk.invalid_params");
    // Preserve this key for one safe retry after transport ambiguity. No new shell.
    let result: { session_id: string; input_sequence: number };
    try { result = await transport.call("host.pty.create", params, options); }
    catch (error) {
      if (!(error instanceof PioneerError) || error.code !== "sdk.delivery_unknown") throw error;
      uncertain(true);
      if (options.signal?.aborted) throw error;
      result = await transport.call("host.pty.create", params, options);
    }
    if (typeof result?.session_id !== "string" || !integer(result.input_sequence)) {
      uncertain(true); throw failure("sdk.invalid_response");
    }
    uncertain(false);
    return new Pty(transport, result.session_id, result.input_sequence, release);
  }
  #assert() {
    if (this.#disposed) throw failure("sdk.closed");
    if (this.#transport.closedError) throw this.#transport.closedError;
    if (this.#leaseError) throw this.#leaseError;
  }
  /** Resolves when Gateway accepts input; does not prove shell execution. */
  write(input: string | Uint8Array, options: OperationOptions = {}): Promise<void> {
    try { this.#assert(); } catch (error) { return Promise.reject(error); }
    const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : Uint8Array.from(input);
    if (bytes.length > 16384) return Promise.reject(failure("sdk.limit"));
    if (this.#queued >= 16) return Promise.reject(failure("sdk.capacity"));
    this.#queued++;
    const operation = this.#queue.then(async () => {
      this.#assert();
      if (options.signal?.aborted) throw failure("sdk.cancelled");
      if (this.#blocked) throw failure("sdk.input_blocked");
      if (!bytes.length) return;
      if (!Number.isSafeInteger(this.#sequence + 1)) throw failure("sdk.limit");
      const sequence = this.#sequence + 1;
      try {
        const result = await this.#transport.call<{ accepted_sequence: number }>("host.pty.input", { session_id: this.id, sequence, bytes: Array.from(bytes) }, options);
        if (result?.accepted_sequence !== sequence) throw failure("sdk.invalid_response");
        this.#sequence = sequence;
      } catch (error) {
        // Never assign a later sequence after an uncertain write. No replay.
        if (!(error instanceof PioneerError) || !["sdk.cancelled", "sdk.capacity", "sdk.disconnected", "host.input_backpressure"].includes(error.code)) this.#blocked = true;
        throw error;
      }
    }).finally(() => { this.#queued--; });
    this.#queue = operation.catch(() => {});
    return operation;
  }
  async resize(size: Dimensions, options: OperationOptions = {}): Promise<void> {
    this.#assert();
    const result = await this.#transport.call<{ resized: boolean }>("host.pty.resize", { session_id: this.id, dimensions: dimensions(size) }, options);
    if (result?.resized !== true) throw failure("sdk.invalid_response");
  }
  /** Bounded legacy snapshot. This neither advances stream credit nor ACKs it. */
  async read(options: ReadPtyOptions): Promise<PtySnapshot> {
    this.#assert();
    const after = options.after;
    if (!integer(after)) throw failure("sdk.invalid_cursor");
    const value = await this.#transport.call("host.pty.read", { session_id: this.id, after }, options);
    return decodeSnapshot(value, after);
  }
  async keepalive(options: OperationOptions = {}): Promise<void> {
    this.#assert();
    await this.#transport.call<{ alive: boolean }>("host.pty.keepalive", { session_id: this.id }, options, result => {
      if (result?.alive !== true) throw failure("sdk.invalid_response");
      this.#leaseFailures = 0; this.#lastLease = performance.now();
    });
  }
  /** Legacy invalidation hint; Gateway suppresses it after any stream subscribe. */
  onChanged(listener: (head: PtyHead) => void): () => void {
    this.#assert();
    if (this.#changeListeners.size >= 64) throw failure("sdk.capacity");
    this.#changeListeners.add(listener);
    return () => { this.#changeListeners.delete(listener); };
  }
  async subscribe(options: SubscribeOptions): Promise<OutputSubscription> {
    this.#assert();
    if (this.#subscription) throw failure("sdk.subscription_exists");
    let cursor = options.after ?? 0;
    if (!integer(cursor)) throw failure("sdk.invalid_cursor");
    let delivered = cursor, stream = "", generation = 0, active = true, recovering = true, recoveries = 0;
    let outstanding: number[] = [];
    let pendingAcks = 0;
    let ackQueue = Promise.resolve();
    const transport = this.#transport;
    const dispose = () => {
      if (!active) return;
      active = false; generation++;
      transport.outputs.delete(this.id);
      transport.disconnects.delete(reconnect);
      options.signal?.removeEventListener("abort", abortSubscription);
      this.#subscription = null;
      this.#detachSubscription = null;
      this.#failSubscription = null;
      // No wire unsubscribe: stop granting credit. The bounded connection-local
      // stream is replaced by subscribe, removed by PTY close or disconnect.
    };
    const fail = (error: unknown) => {
      if (!active) return;
      dispose();
      try { options.onError(error instanceof PioneerError ? error : failure("sdk.callback_failed")); } catch { /* Consumer owns diagnostics. */ }
    };
    const receive = (raw: unknown) => {
      const f = raw as Record<string, any>;
      if (!active || f.stream_id !== stream) return;
      if (f.error) { fail(hostFailure(f.error)); return; }
      if (!integer(f.after) || !integer(f.next) || !integer(f.end) || f.after !== delivered ||
          !Array.isArray(f.bytes) || f.bytes.length > 16384 || !f.bytes.every((b: unknown) => integer(b) && b <= 255) ||
          f.next !== f.after + f.bytes.length || f.end < f.next || typeof f.failed !== "boolean" ||
          !(f.exit_status === null || (integer(f.exit_status) && f.exit_status <= 0xffffffff))) { fail(failure("sdk.invalid_output")); return; }
      if (f.next - cursor > 65536 || (f.next > f.after && outstanding.length >= 64)) { fail(failure("sdk.capacity")); return; }
      if (f.next > f.after) outstanding.push(f.next);
      delivered = f.next;
      const token = generation, next: number = f.next;
      const ack = () => {
        if (pendingAcks >= 64) return Promise.reject(failure("sdk.capacity"));
        pendingAcks++;
        const operation = ackQueue.then(async () => {
          if (!active || generation !== token) throw failure("sdk.stale_receipt");
          if (next <= cursor) return;
          await transport.call<{ acknowledged: boolean }>("host.pty.ack", { session_id: this.id, stream_id: stream, after: next }, {}, result => {
            if (!active || generation !== token || result?.acknowledged !== true) throw failure("sdk.stale_receipt");
            cursor = Math.max(cursor, next);
            outstanding = outstanding.filter(end => end > cursor);
          });
        }).finally(() => { pendingAcks--; });
        ackQueue = operation.catch(() => {});
        return operation;
      };
      try { options.onOutput(Object.freeze({ streamId: stream, bytes: Uint8Array.from(f.bytes), after: f.after, next, end: f.end, exitStatus: f.exit_status, failed: f.failed, ack })); }
      catch (error) { fail(error); }
    };
    const watch = async () => {
      if (!active) return;
      generation++; stream = randomUUID(); delivered = cursor; outstanding = [];
      transport.outputs.set(this.id, receive);
      let connection = -1;
      await transport.call<{ subscribed: boolean; window: number }>("host.pty.subscribe", { session_id: this.id, stream_id: stream, after: cursor }, options, result => {
        if (result?.subscribed !== true || result.window !== 65536) throw failure("sdk.invalid_response");
        connection = transport.generation;
      });
      if (!active) throw failure("sdk.cancelled");
      if (transport.closedError) throw transport.closedError;
      if (transport.generation !== connection) throw failure("sdk.disconnected");
    };
    const restore = async (firstError: unknown) => {
      let last = firstError;
      while (active && recoveries++ < 3) {
        if (last instanceof PioneerError && (last.source === "host" || !["sdk.disconnected", "sdk.delivery_unknown"].includes(last.code))) throw last;
        try { await watch(); return; } catch (error) { last = error; }
      }
      throw last;
    };
    const reconnect = () => {
      if (!active) return;
      generation++;
      if (recovering) return;
      if (transport.closedError) { fail(transport.closedError); return; }
      recovering = true;
      void restore(failure("sdk.disconnected")).catch(fail).finally(() => { recovering = false; });
    };
    const abortSubscription = () => dispose();
    const subscription: OutputSubscription = Object.freeze({ get cursor() { return cursor; }, dispose: () => dispose() });
    this.#subscription = subscription;
    this.#detachSubscription = dispose;
    this.#failSubscription = fail;
    transport.disconnects.add(reconnect);
    options.signal?.addEventListener("abort", abortSubscription, { once: true });
    if (options.signal?.aborted) { dispose(); throw failure("sdk.cancelled"); }
    try {
      try { await watch(); } catch (error) { await restore(error); }
    }
    catch (error) { dispose(); throw error; }
    finally { recovering = false; }
    if (!active) throw failure("sdk.cancelled");
    return subscription;
  }
  /** Local teardown; used by context close even if Gateway is unreachable. */
  #disposeLocal() {
    if (this.#disposed) return;
    this.#disposed = true;
    clearInterval(this.#heartbeat);
    this.#heartbeatAbort.abort();
    this.#transport.disconnects.delete(this.#onDisconnect);
    this.#transport.changes.delete(this.id);
    this.#changeListeners.clear();
    this.#detachSubscription?.();
  }
  /** Destroy this owned PTY, separately from unsubscribing output. */
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#disposeLocal();
    this.#closing = this.#transport.call<{ closed: boolean }>("host.pty.close", { session_id: this.id }).then(result => {
      if (result?.closed !== true) throw failure("sdk.invalid_response");
      this.#release();
    });
    return this.#closing;
  }
}
