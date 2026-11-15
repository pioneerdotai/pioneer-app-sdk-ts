import { randomUUID } from "node:crypto";
import { failure, hostFailure, PioneerError } from "../error.js";
import { Transport } from "./transport.js";
import type { OperationOptions } from "./transport.js";

export interface Dimensions { cols: number; rows: number; pixelWidth?: number; pixelHeight?: number }
export interface CreatePtyOptions extends Dimensions, OperationOptions { command?: readonly string[]; cwd?: string }
export interface OutputFrame {
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
  #heartbeat: ReturnType<typeof setInterval>;
  #keeping = false;
  #leaseError: PioneerError | null = null;
  #release: () => void;
  private constructor(transport: Transport, readonly id: string, sequence: number, release: () => void) {
    this.#transport = transport;
    this.#sequence = sequence;
    this.#release = release;
    this.#heartbeat = setInterval(() => {
      if (this.#keeping || this.#disposed || this.#leaseError) return;
      this.#keeping = true;
      void transport.call("host.pty.keepalive", { session_id: id }).catch(error => {
        this.#leaseError = error instanceof PioneerError ? error : failure("sdk.disconnected");
        clearInterval(this.#heartbeat);
      }).finally(() => { this.#keeping = false; });
    }, 10000);
    this.#heartbeat.unref();
  }
  static async create(transport: Transport, options: CreatePtyOptions, release: () => void): Promise<Pty> {
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
      if (!(error instanceof PioneerError) || error.code !== "sdk.delivery_unknown" || options.signal?.aborted) throw error;
      result = await transport.call("host.pty.create", params, options);
    }
    if (typeof result?.session_id !== "string" || !integer(result.input_sequence)) throw failure("sdk.invalid_response");
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
    await this.#transport.call("host.pty.resize", { session_id: this.id, dimensions: dimensions(size) }, options);
  }
  async subscribe(options: SubscribeOptions): Promise<OutputSubscription> {
    this.#assert();
    if (this.#subscription) throw failure("sdk.subscription_exists");
    let cursor = options.after ?? 0;
    if (!integer(cursor)) throw failure("sdk.invalid_cursor");
    let delivered = cursor, stream = "", generation = 0, active = true, recovering = false, recoveries = 0;
    let outstanding = 0;
    let pendingAcks = 0;
    let ackQueue = Promise.resolve();
    const transport = this.#transport;
    const dispose = (reset = true) => {
      if (!active) return;
      active = false; generation++;
      transport.outputs.delete(this.id);
      transport.disconnects.delete(reconnect);
      options.signal?.removeEventListener("abort", abortSubscription);
      this.#subscription = null;
      this.#detachSubscription = null;
      // There is no wire unsubscribe. Closing the shared connection removes
      // its streams; other subscriptions recover from their consumed cursors.
      if (reset) transport.reset();
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
          !(f.exit_status === null || integer(f.exit_status))) { fail(failure("sdk.invalid_output")); return; }
      if (f.next - cursor > 65536 || ++outstanding > 66) { fail(failure("sdk.capacity")); return; }
      delivered = f.next;
      const token = generation, next: number = f.next;
      const ack = () => {
        if (pendingAcks >= 64) return Promise.reject(failure("sdk.capacity"));
        pendingAcks++;
        const operation = ackQueue.then(async () => {
          if (!active || generation !== token) throw failure("sdk.stale_receipt");
          if (next <= cursor) return;
          const result = await transport.call<{ acknowledged: boolean }>("host.pty.ack", { session_id: this.id, stream_id: stream, after: next });
          if (!active || generation !== token) throw failure("sdk.stale_receipt");
          if (result?.acknowledged !== true) throw failure("sdk.stale_receipt");
          cursor = Math.max(cursor, next);
          outstanding = 0;
        }).finally(() => { pendingAcks--; });
        ackQueue = operation.catch(() => {});
        return operation;
      };
      try { options.onOutput(Object.freeze({ bytes: Uint8Array.from(f.bytes), after: f.after, next, end: f.end, exitStatus: f.exit_status, failed: f.failed, ack })); }
      catch (error) { fail(error); }
    };
    const watch = async () => {
      if (!active) return;
      generation++; stream = randomUUID(); delivered = cursor; outstanding = 0;
      transport.outputs.set(this.id, receive);
      await transport.call("host.pty.subscribe", { session_id: this.id, stream_id: stream, after: cursor }, options);
    };
    const reconnect = () => {
      if (!active || recovering) return;
      generation++;
      if (transport.closedError) { fail(transport.closedError); return; }
      recovering = true;
      void (async () => {
        let last: unknown = failure("sdk.disconnected");
        while (active && recoveries++ < 3) {
          try { await watch(); return; }
          catch (error) {
            last = error;
            if (error instanceof PioneerError && error.source === "host") break;
          }
        }
        if (active) fail(last);
      })().finally(() => { recovering = false; });
    };
    const abortSubscription = () => dispose();
    const subscription: OutputSubscription = Object.freeze({ get cursor() { return cursor; }, dispose: () => dispose() });
    this.#subscription = subscription;
    this.#detachSubscription = () => dispose(false);
    transport.disconnects.add(reconnect);
    options.signal?.addEventListener("abort", abortSubscription, { once: true });
    if (options.signal?.aborted) { dispose(); throw failure("sdk.cancelled"); }
    try { await watch(); }
    catch (error) { dispose(); throw error; }
    if (!active) throw failure("sdk.cancelled");
    return subscription;
  }
  /** Local teardown; used by context close even if Gateway is unreachable. */
  #disposeLocal() {
    if (this.#disposed) return;
    this.#disposed = true;
    clearInterval(this.#heartbeat);
    this.#detachSubscription?.();
  }
  /** Destroy this owned PTY, separately from unsubscribing output. */
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#disposeLocal();
    this.#closing = this.#transport.call("host.pty.close", { session_id: this.id }).then(() => {}).finally(this.#release);
    return this.#closing;
  }
}
