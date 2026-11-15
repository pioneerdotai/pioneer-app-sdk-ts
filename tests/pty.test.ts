import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createAppServerContext } from '../src/server/index.js';
import type { OutputFrame, Pty } from '../src/server/index.js';

type Request = { id: string; method: string; params: any; socket: WebSocket };
function channel<T>(t: TestContext) {
  const values: T[] = [];
  const waiters = new Set<{ resolve(value: T): void; reject(error: unknown): void }>();
  let closed: Error | undefined;
  const close = () => {
    closed ??= new Error('Test channel closed');
    values.length = 0;
    for (const waiter of [...waiters]) waiter.reject(closed);
  };
  t.after(close);
  return {
    push(value: T) {
      if (closed) return;
      const waiter = waiters.values().next().value;
      if (waiter) waiter.resolve(value); else values.push(value);
    },
    next(signal?: AbortSignal): Promise<T> {
      const pending = new Promise<T>((resolve, reject) => {
        const cleanup = () => { waiters.delete(waiter); signal?.removeEventListener('abort', abort); };
        const waiter = {
          resolve(value: T) { cleanup(); resolve(value); },
          reject(error: unknown) { cleanup(); reject(error); },
        };
        const abort = () => waiter.reject(signal?.reason);
        if (closed) { reject(closed); return; }
        if (signal?.aborted) { reject(signal.reason); return; }
        if (values.length) { resolve(values.shift()!); return; }
        waiters.add(waiter);
        signal?.addEventListener('abort', abort, { once: true });
      });
      // Teardown can reject a waiter whose test body has already been cancelled.
      // Keep the returned promise rejected for its caller, but observe it now.
      void pending.catch(() => {});
      return pending;
    },
    close,
  };
}
interface PeerOptions {
  create?(request: Request, result: { session_id: string; input_sequence: number; retention_seconds: number }): void;
  close?(request: Request): void;
  manualKeepalive?: boolean;
  admit?(attempt: number): boolean;
}
async function peer(t: TestContext, options: PeerOptions = {}) {
  let upgrades = 0;
  let stopping = false;
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0,
    verifyClient: (_info, done) => done(!stopping && (options.admit?.(++upgrades) ?? true), 503),
  });
  await once(server, 'listening');
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('test address missing');
  const calls = channel<Request>(t);
  const requests: Request[] = [];
  const connections: WebSocket[] = [];
  const creates = new Map<string, { params: string; session_id: string }>();
  const sessions = new Set<string>();
  const streams = new Map<WebSocket, Map<string, string>>();
  const ids = new Set<string>();
  const endpoint = `ws://127.0.0.1:${address.port}/apps/host`;
  const clients = new Map<WebSocket, Promise<void>>();
  const serverClosed = new Map<WebSocket, Promise<void>>();
  const clientForServer = new Map<WebSocket, WebSocket>();
  const emit = WebSocket.prototype.emit;
  t.mock.method(WebSocket.prototype, 'emit', function(this: WebSocket, event: string | symbol, ...args: any[]) {
    // Positive identity: only clients of this peer's unique listening endpoint.
    if (this.url === endpoint) {
      if (!clients.has(this)) {
        let closed!: () => void;
        clients.set(this, new Promise<void>(resolve => { closed = resolve; }));
        this.once('close', () => closed());
      }
      if (event === 'message') {
        const message = JSON.parse(args[0].toString());
        const request = requests.find(request => request.id === message.id);
        if (request) clientForServer.set(request.socket, this);
      }
      if (stopping && (this.readyState === WebSocket.OPEN || this.readyState === WebSocket.CONNECTING)) this.terminate();
    }
    return emit.call(this, event, ...args);
  });
  server.on('connection', (socket, upgrade) => {
    assert.equal(upgrade.headers.authorization, `Bearer ${'b'.repeat(64)}`);
    assert.equal(upgrade.headers.origin, undefined);
    connections.push(socket);
    serverClosed.set(socket, new Promise(resolve => socket.once('close', () => resolve())));
    streams.set(socket, new Map());
    socket.on('close', () => streams.delete(socket));
    socket.on('message', raw => {
      const request = { ...JSON.parse(raw.toString()), socket } as Request;
      // Gateway deserializes RequestId before dispatch. Do not silently accept UUIDs.
      assert.equal(typeof request.id, 'string');
      assert.equal([...request.id].length, 21);
      assert.ok(!ids.has(request.id), 'request ID reused');
      ids.add(request.id);
      requests.push(request);
      if (request.method === 'host.pty.create') {
        const params = request.params;
        assert.ok(typeof params.key === 'string' && Buffer.byteLength(params.key) > 0 && Buffer.byteLength(params.key) <= 128);
        assert.ok(params.dimensions.cols > 0 && params.dimensions.cols <= 1000);
        assert.ok(params.dimensions.rows > 0 && params.dimensions.rows <= 1000);
        const previous = creates.get(params.key);
        if (previous) assert.equal(JSON.stringify(params), previous.params, 'same-key retry changed parameters');
        const session_id = previous?.session_id ?? `session-${creates.size + 1}`;
        creates.set(params.key, { session_id, params: JSON.stringify(params) });
        sessions.add(session_id);
        const result = { session_id, input_sequence: 0, retention_seconds: 300 };
        if (options.create) options.create(request, result);
        else reply(request, result);
      } else if (request.method === 'host.pty.close') {
        if (options.close) options.close(request);
        else {
          sessions.delete(request.params.session_id);
          streams.get(socket)?.delete(request.params.session_id);
          reply(request, { closed: true });
        }
      } else {
        assert.ok(sessions.has(request.params.session_id), 'unknown session');
        if (request.method === 'host.pty.subscribe') {
          assert.ok(request.params.stream_id.length > 0 && request.params.stream_id.length <= 128);
          streams.get(socket)!.set(request.params.session_id, request.params.stream_id);
        }
        if (request.method === 'host.pty.input') {
          assert.ok(request.params.bytes.length > 0 && request.params.bytes.length <= 16384);
        }
        if (request.method === 'host.pty.ack') {
          assert.equal(streams.get(socket)?.get(request.params.session_id), request.params.stream_id);
        }
        if (request.method === 'host.pty.keepalive' && !options.manualKeepalive) reply(request, { alive: true });
        else calls.push(request);
      }
    });
  });
  const app = await createAppServerContext({
    appData: '/data',
    bootstrap: { execution_id: 'execution_fixture_001', ui_proxy: { credential: 'a'.repeat(64) },
      host_api: { endpoint, credential: 'b'.repeat(64), capabilities: ['host.pty'] } },
  });
  let serverStopped: Promise<void> | undefined;
  const drain = async () => {
    if (!stopping) {
      stopping = true;
      calls.close();
      serverStopped = new Promise<void>(resolve => server.close(() => resolve()));
      for (const socket of [...clients.keys(), ...connections]) {
        if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      }
    }
    await Promise.all([...clients.values(), ...serverClosed.values(), serverStopped]);
  };
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    try { await app.close(); }
    finally { await drain(); }
  })();
  t.after(async () => {
    const bodyOwnsClose = closing !== undefined;
    const result = close().then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
    // Also run when a failed/cancelled body is stuck awaiting a mock reply.
    await drain();
    const settled = await result;
    // Include any handshake that was already queued when teardown started.
    // Once SDK close settles it can no longer create a replacement socket.
    await drain();
    if (!bodyOwnsClose && !settled.ok) throw settled.error;
  });
  return { app, calls, requests, connections, streams, close,
    async disconnect(request: Request) {
      const client = clientForServer.get(request.socket);
      assert.ok(client, 'connection must have a correlated RPC response');
      const closed = clients.get(client)!;
      request.socket.terminate();
      await Promise.all([closed, serverClosed.get(request.socket)!]);
    },
  };
}
function reply(request: Request, result: unknown) {
  request.socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
}
function output(request: Request, after: number, bytes: number[]) {
  request.socket.send(JSON.stringify(outputMessage(request, after, bytes)));
}
function outputMessage(request: Request, after: number, bytes: number[]) {
  return { jsonrpc: '2.0', method: 'host.pty.output', params: {
    session_id: request.params.session_id, stream_id: request.params.stream_id,
    after, next: after + bytes.length, end: after + bytes.length, bytes, exit_status: null, failed: false,
  } };
}
function reject(request: Request, code: string) {
  request.socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32001, message: code } }));
}

test('explicit consumption, reconnect cursor, old receipts and unsubscribe ownership', { timeout: 5000 }, async t => {
  const p = await peer(t);
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24, command: ['/bin/sh'], cwd: '/tmp' });
    const frames = channel<OutputFrame>(t);
    const errors: unknown[] = [];
    const opening = terminal.subscribe({ onOutput: frame => frames.push(frame), onError: error => errors.push(error) });
    const first = await p.calls.next();
    reply(first, { subscribed: true, window: 65536 });
    const sub = await opening;
    output(first, 0, [65]);
    const unconsumed = await frames.next();
    assert.equal(sub.cursor, 0); // Callback delivery has not consumed anything.
    first.socket.terminate();
    const replacement = await p.calls.next();
    assert.equal(replacement.method, 'host.pty.subscribe');
    assert.equal(replacement.params.after, 0);
    reply(replacement, { subscribed: true, window: 65536 });
    output(replacement, 0, [65]);
    const replay = await frames.next();
    await assert.rejects(unconsumed.ack(), { code: 'sdk.stale_receipt' });
    const ack = replay.ack();
    const request = await p.calls.next();
    assert.equal(request.method, 'host.pty.ack');
    assert.equal(request.params.after, 1);
    reply(request, { acknowledged: true });
    await ack;
    assert.equal(sub.cursor, 1);
    sub.dispose();
    await assert.rejects(replay.ack(), { code: 'sdk.stale_receipt' });
    const write = terminal.write('still alive');
    const input = await p.calls.next();
    assert.equal(input.method, 'host.pty.input');
    reply(input, { accepted_sequence: 1 });
    await write;
    assert.deepEqual(errors, []);
    await terminal.close();
    await assert.rejects(terminal.write('closed'), { code: 'sdk.closed' });
  } finally { await p.close(); }
});

test('unknown input is never replayed and blocks later writes; queued capacity is finite', { timeout: 5000 }, async t => {
  const p = await peer(t);
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
    const first = terminal.write('dangerous');
    const failed = assert.rejects(first, { code: 'sdk.delivery_unknown' });
    const input = await p.calls.next();
    const queued = Array.from({ length: 15 }, () => assert.rejects(terminal.write('later'), { code: 'sdk.input_blocked' }));
    await assert.rejects(terminal.write('overflow'), { code: 'sdk.capacity' });
    input.socket.terminate();
    await failed;
    await Promise.all(queued);
    await assert.rejects(terminal.write('retry'), { code: 'sdk.input_blocked' });
  } finally { await p.close(); }
});

test('cancelled unsent input does not occupy the next sequence; sent cancellation is ambiguous', { timeout: 5000 }, async t => {
  const p = await peer(t);
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
    const queuedAbort = new AbortController();
    const first = terminal.write('one');
    const request = await p.calls.next();
    const skipped = terminal.write('cancel', { signal: queuedAbort.signal });
    const skippedResult = assert.rejects(skipped, { code: 'sdk.cancelled' });
    queuedAbort.abort();
    reply(request, { accepted_sequence: 1 });
    await first; await skippedResult;
    const sentAbort = new AbortController();
    const second = terminal.write('two', { signal: sentAbort.signal });
    const unknown = assert.rejects(second, { code: 'sdk.delivery_unknown' });
    const sent = await p.calls.next();
    assert.equal(sent.params.sequence, 2);
    sentAbort.abort();
    await unknown;
    await assert.rejects(terminal.write('three'), { code: 'sdk.input_blocked' });
  } finally { await p.close(); }
});

test('cursor loss preserves Gateway error code instead of skipping output', { timeout: 5000 }, async t => {
  const p = await peer(t);
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
    const subscription = terminal.subscribe({ after: 17, onOutput() { assert.fail('lost output delivered'); }, onError() {} });
    const rejected = assert.rejects(subscription, { code: 'host.output_cursor_expired', source: 'host', rpcCode: -32001 });
    const request = await p.calls.next();
    request.socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32001, message: 'host.output_cursor_expired' } }));
    await rejected;
  } finally { await p.close(); }
});

test('output without consumption is bounded and stream cancellation does not kill the PTY', { timeout: 5000 }, async t => {
  const p = await peer(t);
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
    const errors = channel<unknown>(t);
    const abort = new AbortController();
    let callbacks = 0;
    const pending = terminal.subscribe({ signal: abort.signal, onOutput() { callbacks++; }, onError: error => errors.push(error) });
    const request = await p.calls.next();
    reply(request, { subscribed: true, window: 65536 });
    await pending;
    const chunk = Array(16384).fill(65);
    for (let i = 0; i < 5; i++) output(request, i * chunk.length, chunk);
    assert.equal((await errors.next() as { code: string }).code, 'sdk.capacity');
    assert.equal(callbacks, 4);
    const writing = terminal.write('alive');
    const input = await p.calls.next();
    assert.equal(input.method, 'host.pty.input');
    reply(input, { accepted_sequence: 1 });
    await writing;
    const next = terminal.subscribe({ signal: abort.signal, onOutput() {}, onError() {} });
    const subscribed = await p.calls.next();
    reply(subscribed, { subscribed: true, window: 65536 });
    const subscription = await next;
    abort.abort();
    subscription.dispose();
    await p.app.close();
    await assert.rejects(terminal.resize({ cols: 10, rows: 10 }), { code: 'sdk.closed' });
    await assert.rejects(p.app.host.pty.create({ cols: 80, rows: 24 }), { code: 'sdk.closed' });
  } finally { await p.close(); }
});

test('unsubscribing A preserves pending input and the existing stream of distinct PTY B', { timeout: 5000 }, async t => {
  const p = await peer(t);
  try {
    const a = await p.app.host.pty.create({ cols: 80, rows: 24 });
    const b = await p.app.host.pty.create({ cols: 80, rows: 24 });
    assert.notEqual(a.id, b.id);
    const aFrames = channel<OutputFrame>(t), bFrames = channel<OutputFrame>(t);
    let callbacksA = 0;
    const errors: unknown[] = [];
    const openingA = a.subscribe({ onOutput: frame => { callbacksA++; aFrames.push(frame); }, onError: error => errors.push(error) });
    const streamA = await p.calls.next(); reply(streamA, { subscribed: true, window: 65536 });
    const subA = await openingA;
    const openingB = b.subscribe({ onOutput: frame => bFrames.push(frame), onError: error => errors.push(error) });
    const streamB = await p.calls.next(); reply(streamB, { subscribed: true, window: 65536 });
    await openingB;
    output(streamA, 0, [65]);
    const oldA = await aFrames.next();
    const writing = b.write('B pending');
    const input = await p.calls.next();
    const accepted = writing.then(() => true); // Attach before any possible disconnect.
    subA.dispose();
    await assert.rejects(oldA.ack(), { code: 'sdk.stale_receipt' });
    reply(input, { accepted_sequence: 1 });
    assert.equal(await accepted, true);
    output(streamA, 1, [67]); // Residual output is ignored locally, not ACKed.
    output(streamB, 0, [66]);
    assert.deepEqual([...(await bFrames.next()).bytes], [66]);
    assert.equal(callbacksA, 1);
    const nextWrite = b.write('B continues');
    const nextInput = await p.calls.next();
    assert.equal(nextInput.method, 'host.pty.input');
    assert.equal(nextInput.params.sequence, 2);
    reply(nextInput, { accepted_sequence: 2 }); await nextWrite;
    assert.equal(p.connections.length, 1);
    assert.equal(p.requests.filter(r => r.method === 'host.pty.subscribe' && r.params.session_id === b.id).length, 1);
    const replacementFrames = channel<OutputFrame>(t);
    const replacing = a.subscribe({ onOutput: frame => replacementFrames.push(frame), onError: error => errors.push(error) });
    const replacement = await p.calls.next(); reply(replacement, { subscribed: true, window: 65536 });
    await replacing;
    assert.notEqual(replacement.params.stream_id, streamA.params.stream_id);
    output(streamA, 2, [69]); // Superseded stream ID must stay fenced.
    output(replacement, 0, [68]);
    assert.deepEqual([...(await replacementFrames.next()).bytes], [68]);
    assert.equal(callbacksA, 1);
    await a.close();
    assert.equal(p.streams.get(streamA.socket)?.has(a.id), false);
    assert.deepEqual(errors, []);
  } finally { await p.close(); }
});

// Drive the documented ws boundary deterministically: ACK response and all
// subsequent output events run in one JS stack, before any Promise continuation.
// This schedules received public WebSocket events, not SDK private callbacks.
function synchronousAckBurst(t: TestContext) {
  const bursts = new Map<string, object[]>();
  const emit = WebSocket.prototype.emit;
  t.mock.method(WebSocket.prototype, 'emit', function(this: WebSocket, event: string | symbol, ...args: any[]) {
    const result = emit.call(this, event, ...args);
    if (event === 'message') {
      const message = JSON.parse(args[0].toString());
      const burst = message.result?.acknowledged === true ? bursts.get(message.id) : undefined;
      if (burst) {
        bursts.delete(message.id);
        for (const output of burst) emit.call(this, 'message', Buffer.from(JSON.stringify(output)), false);
      }
    }
    return result;
  });
  return bursts;
}

test('confirmed partial ACK grants byte credit before a synchronous next-output burst', { timeout: 5000 }, async t => {
  const bursts = synchronousAckBurst(t);
  const p = await peer(t);
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
    const frames = channel<OutputFrame>(t), errors: unknown[] = [];
    const pending = terminal.subscribe({ onOutput: frame => frames.push(frame), onError: error => errors.push(error) });
    const stream = await p.calls.next(); reply(stream, { subscribed: true, window: 65536 });
    const sub = await pending;
    const chunk = Array(16384).fill(65);
    for (let i = 0; i < 4; i++) output(stream, i * chunk.length, chunk);
    const received = [];
    for (let i = 0; i < 4; i++) received.push(await frames.next());
    assert.equal(sub.cursor, 0);
    const confirming = received[1].ack();
    const ack = await p.calls.next();
    assert.equal(ack.params.after, 32768);
    assert.equal(sub.cursor, 0, 'sending an ACK is not confirmation');
    bursts.set(ack.id, [outputMessage(stream, 65536, chunk), outputMessage(stream, 81920, chunk)]);
    reply(ack, { acknowledged: true });
    await confirming;
    assert.equal((await frames.next()).next, 81920);
    assert.equal((await frames.next()).next, 98304);
    assert.equal(sub.cursor, 32768);
    assert.deepEqual(errors, []);
  } finally { await p.close(); }
});

test('partial cumulative ACK retains remaining outstanding frames and rejects a true 65th data frame', { timeout: 5000 }, async t => {
  const bursts = synchronousAckBurst(t);
  const p = await peer(t);
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
    const frames = channel<OutputFrame>(t), errors = channel<unknown>(t);
    const pending = terminal.subscribe({ onOutput: frame => frames.push(frame), onError: error => errors.push(error) });
    const stream = await p.calls.next(); reply(stream, { subscribed: true, window: 65536 }); await pending;
    for (let i = 0; i < 64; i++) output(stream, i, [65]);
    const first = await frames.next();
    for (let i = 1; i < 64; i++) await frames.next();
    const confirming = first.ack();
    const ack = await p.calls.next();
    // Only one of the 64 ends is consumed. First new frame is valid; second
    // deliberately violates frame credit despite being inside the byte limit.
    bursts.set(ack.id, [outputMessage(stream, 64, [66]), outputMessage(stream, 65, [67])]);
    reply(ack, { acknowledged: true }); await confirming;
    assert.equal((await frames.next()).next, 65);
    assert.equal((await errors.next() as { code: string }).code, 'sdk.capacity');
  } finally { await p.close(); }
});

async function barrier(terminal: Pty, calls: ReturnType<typeof channel<Request>>) {
  const operation = terminal.resize({ cols: 80, rows: 24 });
  const outcome = operation.then(() => ({ kind: 'completed' as const }), error => ({ kind: 'failed' as const, error }));
  const waiting = new AbortController();
  try {
    const first = await Promise.race([
      calls.next(waiting.signal).then(request => ({ kind: 'request' as const, request })),
      outcome,
    ]);
    if (first.kind === 'failed') throw first.error;
    if (first.kind !== 'request') throw new Error('resize completed without its peer request');
    assert.equal(first.request.method, 'host.pty.resize');
    reply(first.request, { resized: true });
    await operation;
  } finally { waiting.abort(); }
}

// Only SDK heartbeat intervals are advanced; real RPC timeout/handshake timers
// remain real. The fake supports unref, without relying on Node mock-timer ABI.
function heartbeatClock(t: TestContext) {
  const callbacks = new Map<unknown, () => void>();
  t.mock.method(globalThis, 'setInterval', ((callback: () => void, ms: number) => {
    assert.equal(ms, 10000);
    const timer = { unref() { return this; } };
    callbacks.set(timer, callback);
    return timer;
  }) as unknown as typeof setInterval);
  t.mock.method(globalThis, 'clearInterval', (timer: unknown) => { callbacks.delete(timer); });
  return { tick(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += 10000) {
      for (const callback of [...callbacks.values()]) callback();
    }
  } };
}

test('temporary keepalive error and transport loss recover without replacing the shell', { timeout: 5000 }, async t => {
  const clock = heartbeatClock(t);
  const p = await peer(t, { manualKeepalive: true });
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
    clock.tick(10000);
    const first = await p.calls.next(); assert.equal(first.method, 'host.pty.keepalive');
    reject(first, 'host.operation_failed');
    await barrier(terminal, p.calls);
    clock.tick(10000);
    const second = await p.calls.next(); assert.equal(second.method, 'host.pty.keepalive');
    await p.disconnect(second);
    await barrier(terminal, p.calls);
    clock.tick(10000);
    const third = await p.calls.next(); assert.equal(third.method, 'host.pty.keepalive');
    reply(third, { alive: true }); await barrier(terminal, p.calls);
    const writing = terminal.write('after recovery');
    const input = await p.calls.next(); reply(input, { accepted_sequence: 1 }); await writing;
    assert.equal(p.requests.filter(r => r.method === 'host.pty.create').length, 1);
    await terminal.close();
    const heartbeats = p.requests.filter(r => r.method === 'host.pty.keepalive').length;
    clock.tick(60000);
    await p.app.close();
    assert.equal(p.requests.filter(r => r.method === 'host.pty.keepalive').length, heartbeats);
  } finally { await p.close(); }
});

test('local request capacity does not turn a missed heartbeat into permanent PTY failure', { timeout: 5000 }, async t => {
  const clock = heartbeatClock(t);
  const p = await peer(t, { manualKeepalive: true });
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
    const operations = Array.from({ length: 64 }, () => terminal.resize({ cols: 80, rows: 24 }));
    const completed = Promise.all(operations);
    void completed.catch(() => {}); // Observe teardown failures before all requests arrive.
    const pending: Request[] = [];
    for (let i = 0; i < 64; i++) pending.push(await p.calls.next());
    clock.tick(10000);
    for (const request of pending) reply(request, { resized: true });
    await completed;
    await barrier(terminal, p.calls);
    clock.tick(10000);
    const heartbeat = await p.calls.next(); assert.equal(heartbeat.method, 'host.pty.keepalive');
    reply(heartbeat, { alive: true }); await barrier(terminal, p.calls);
  } finally { await p.close(); }
});

for (const error of ['host.session_expired', 'host.session_unavailable', 'host.revoked']) {
  test(`definitive keepalive ${error} stops delivery, heartbeat and future operations`, { timeout: 5000 }, async t => {
    const clock = heartbeatClock(t);
    const p = await peer(t, { manualKeepalive: true });
    try {
      const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
      const errors = channel<unknown>(t);
      const pending = terminal.subscribe({ onOutput() {}, onError: value => errors.push(value) });
      const stream = await p.calls.next(); reply(stream, { subscribed: true, window: 65536 }); await pending;
      clock.tick(10000);
      const heartbeat = await p.calls.next(); reject(heartbeat, error);
      assert.equal((await errors.next() as { code: string }).code, error);
      await assert.rejects(terminal.write('no'), { code: error });
      clock.tick(60000);
      if (error === 'host.revoked') {
        await assert.rejects(p.app.close(), { code: 'sdk.cleanup_incomplete' });
      } else await p.app.close();
      assert.equal(p.requests.filter(r => r.method === 'host.pty.keepalive').length, 1);
    } finally {
      if (error === 'host.revoked') await assert.rejects(p.close(), { code: 'sdk.cleanup_incomplete' });
      else await p.close();
    }
  });
}

test('three consecutive transient heartbeat failures exhaust a finite recovery budget', { timeout: 5000 }, async t => {
  const clock = heartbeatClock(t);
  const p = await peer(t, { manualKeepalive: true });
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
    const errors = channel<unknown>(t);
    const pending = terminal.subscribe({ onOutput() {}, onError: error => errors.push(error) });
    const stream = await p.calls.next(); reply(stream, { subscribed: true, window: 65536 }); await pending;
    for (let i = 0; i < 3; i++) {
      clock.tick(10000);
      const heartbeat = await p.calls.next(); reject(heartbeat, 'host.capacity');
      if (i < 2) await barrier(terminal, p.calls);
    }
    assert.equal((await errors.next() as { code: string }).code, 'sdk.lease_unconfirmed');
    await assert.rejects(terminal.write('no'), { code: 'sdk.lease_unconfirmed' });
    clock.tick(60000);
    await p.app.close();
    assert.equal(p.requests.filter(r => r.method === 'host.pty.keepalive').length, 3);
  } finally { await p.close(); }
});

test('unknown create remains uncertain when retry cannot connect and send', { timeout: 5000 }, async t => {
  const p = await peer(t, { admit: attempt => attempt === 1, create: request => request.socket.terminate() });
  try {
    await assert.rejects(p.app.host.pty.create({ cols: 80, rows: 24 }), { code: 'sdk.disconnected' });
    const creates = p.requests.filter(r => r.method === 'host.pty.create');
    assert.equal(creates.length, 1);
    const closing = p.app.close();
    assert.equal(p.app.close(), closing);
    await assert.rejects(closing, { code: 'sdk.cleanup_incomplete' });
  } finally { await assert.rejects(p.close(), { code: 'sdk.cleanup_incomplete' }); }
});

test('a validated same-key retry resolves initial create uncertainty and permits confirmed cleanup', { timeout: 5000 }, async t => {
  let attempts = 0;
  const p = await peer(t, { create(request, result) {
    if (++attempts === 1) request.socket.terminate();
    else reply(request, result);
  } });
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
    assert.equal(terminal.id, 'session-1');
    assert.equal(attempts, 2);
    await p.app.close();
    assert.equal(p.requests.filter(r => r.method === 'host.pty.close').length, 1);
  } finally { await p.close(); }
});

test('pre-send cancellation leaves cleanup certain, sent create cancellation does not', { timeout: 5000 }, async t => {
  const accepted = channel<Request>(t);
  const p = await peer(t, { create: request => accepted.push(request) });
  try {
    const before = new AbortController(); before.abort();
    await assert.rejects(p.app.host.pty.create({ cols: 80, rows: 24, signal: before.signal }), { code: 'sdk.cancelled' });
    assert.equal(p.requests.length, 0);
    const after = new AbortController();
    const creating = p.app.host.pty.create({ cols: 80, rows: 24, signal: after.signal });
    const result = assert.rejects(creating, { code: 'sdk.delivery_unknown' });
    await accepted.next(); after.abort(); await result;
    assert.equal(p.requests.filter(r => r.method === 'host.pty.create').length, 1);
    await assert.rejects(p.app.close(), { code: 'sdk.cleanup_incomplete' });
  } finally { await assert.rejects(p.close(), { code: 'sdk.cleanup_incomplete' }); }
  // A context with only a pre-send refusal can still confirm cleanup.
  const clean = await peer(t);
  try {
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(clean.app.host.pty.create({ cols: 80, rows: 24, signal: aborted.signal }), { code: 'sdk.cancelled' });
    await clean.app.close();
  } finally { await clean.close(); }
});

test('failed terminal close stays visible to subsequent context close', { timeout: 5000 }, async t => {
  const p = await peer(t, { close: request => reject(request, 'host.operation_failed') });
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
    const close = terminal.close();
    assert.equal(terminal.close(), close);
    await assert.rejects(close, { code: 'host.operation_failed' });
    await assert.rejects(p.app.close(), { code: 'sdk.cleanup_incomplete' });
    assert.equal(p.requests.filter(r => r.method === 'host.pty.close').length, 1);
    await assert.rejects(terminal.write('closed'), { code: 'sdk.closed' });
  } finally { await assert.rejects(p.close(), { code: 'sdk.cleanup_incomplete' }); }
});

test('context close waits for a concurrent create and confirms destruction exactly once', { timeout: 5000 }, async t => {
  const accepted = channel<{ request: Request; result: object }>(t);
  const p = await peer(t, { create: (request, result) => accepted.push({ request, result }) });
  try {
    const creating = p.app.host.pty.create({ cols: 80, rows: 24 });
    const rejected = assert.rejects(creating, { code: 'sdk.closed' });
    const { request, result } = await accepted.next();
    const closing = p.app.close();
    assert.equal(p.app.close(), closing);
    reply(request, result);
    await closing; await rejected;
    assert.equal(p.requests.filter(r => r.method === 'host.pty.close').length, 1);
  } finally { await p.close(); }
});

test('at most one heartbeat is in flight and close stops it without waiting for its reply', { timeout: 5000 }, async t => {
  const clock = heartbeatClock(t);
  const p = await peer(t, { manualKeepalive: true });
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
    clock.tick(10000);
    const heartbeat = await p.calls.next();
    assert.equal(heartbeat.method, 'host.pty.keepalive');
    clock.tick(30000);
    await barrier(terminal, p.calls);
    assert.equal(p.requests.filter(r => r.method === 'host.pty.keepalive').length, 1);
    await terminal.close();
    clock.tick(60000);
    await p.app.close();
    assert.equal(p.requests.filter(r => r.method === 'host.pty.keepalive').length, 1);
  } finally { await p.close(); }
});

test('barrier propagates pre-send failure and removes its abandoned request waiter', { timeout: 5000 }, async t => {
  const p = await peer(t);
  try {
    const closed = await p.app.host.pty.create({ cols: 80, rows: 24 });
    await closed.close();
    await assert.rejects(barrier(closed, p.calls), { code: 'sdk.closed' });
    // If the failed barrier kept its waiter, it would steal this resize request.
    const active = await p.app.host.pty.create({ cols: 80, rows: 24 });
    await barrier(active, p.calls);
  } finally { await p.close(); }
});
