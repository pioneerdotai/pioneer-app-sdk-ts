import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { createAppServerContext } from '../src/server/index.js';
import type { OutputFrame } from '../src/server/index.js';

type Request = { id: string; method: string; params: any; socket: WebSocket };
function channel<T>() {
  const values: T[] = [];
  const waiters: ((value: T) => void)[] = [];
  return {
    push(value: T) { const waiter = waiters.shift(); if (waiter) waiter(value); else values.push(value); },
    next(): Promise<T> { return values.length ? Promise.resolve(values.shift()!) : new Promise(resolve => waiters.push(resolve)); },
  };
}
async function peer() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('test address missing');
  const calls = channel<Request>();
  server.on('connection', socket => socket.on('message', raw => {
    const request = { ...JSON.parse(raw.toString()), socket } as Request;
    if (request.method === 'host.pty.create') reply(request, { session_id: 'session-1', input_sequence: 0, retention_seconds: 300 });
    else if (request.method === 'host.pty.close' || request.method === 'host.pty.keepalive') reply(request, {});
    else calls.push(request);
  }));
  const app = await createAppServerContext({
    appData: '/data',
    bootstrap: { execution_id: 'execution_fixture_001', ui_proxy: { credential: 'a'.repeat(64) },
      host_api: { endpoint: `ws://127.0.0.1:${address.port}/apps/host`, credential: 'b'.repeat(64), capabilities: ['host.pty'] } },
  });
  return { app, calls, async close() { await app.close(); for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
function reply(request: Request, result: unknown) {
  request.socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
}
function output(request: Request, after: number, bytes: number[]) {
  request.socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'host.pty.output', params: {
    session_id: request.params.session_id, stream_id: request.params.stream_id,
    after, next: after + bytes.length, end: after + bytes.length, bytes, exit_status: null, failed: false,
  } }));
}

test('explicit consumption, reconnect cursor, old receipts and unsubscribe ownership', { timeout: 5000 }, async () => {
  const p = await peer();
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24, command: ['/bin/sh'], cwd: '/tmp' });
    const frames = channel<OutputFrame>();
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

test('unknown input is never replayed and blocks later writes; queued capacity is finite', { timeout: 5000 }, async () => {
  const p = await peer();
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

test('cancelled unsent input does not occupy the next sequence; sent cancellation is ambiguous', { timeout: 5000 }, async () => {
  const p = await peer();
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

test('cursor loss preserves Gateway error code instead of skipping output', { timeout: 5000 }, async () => {
  const p = await peer();
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
    const subscription = terminal.subscribe({ after: 17, onOutput() { assert.fail('lost output delivered'); }, onError() {} });
    const rejected = assert.rejects(subscription, { code: 'host.output_cursor_expired', source: 'host', rpcCode: -32001 });
    const request = await p.calls.next();
    request.socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32001, message: 'host.output_cursor_expired' } }));
    await rejected;
  } finally { await p.close(); }
});

test('output without consumption is bounded and stream cancellation does not kill the PTY', { timeout: 5000 }, async () => {
  const p = await peer();
  try {
    const terminal = await p.app.host.pty.create({ cols: 80, rows: 24 });
    const errors = channel<unknown>();
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
