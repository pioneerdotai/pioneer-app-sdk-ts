import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixture = JSON.parse(await readFile(new URL('../fixtures/protocol.json', import.meta.url), 'utf8'));
function browser(t: TestContext, embedded: boolean, base?: string) {
  const saved = new Map(['window', 'document', 'CSS'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const parent = {};
  const target = Object.assign(new EventTarget(), {
    parent: parent as object,
    location: { href: 'https://gateway.test/proxy/apps/view/grant/nested/page', origin: 'https://gateway.test' },
  });
  if (!embedded) target.parent = target;
  const listeners = new Set<unknown>();
  const add = target.addEventListener, remove = target.removeEventListener;
  t.mock.method(target, 'addEventListener', function(type, listener, options) {
    if (type === 'message') listeners.add(listener);
    add.call(this, type, listener, options);
  });
  t.mock.method(target, 'removeEventListener', function(type, listener, options) {
    if (type === 'message') listeners.delete(listener);
    remove.call(this, type, listener, options);
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: Object.freeze({
    querySelector: () => base === undefined ? null : { getAttribute: () => base },
  }) });
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { supports: (_property: string, color: string) => /^#[0-9a-f]{6}$/.test(color) } });
  t.after(() => {
    try { assert.equal(listeners.size, 0, 'all view listeners must be disposed'); }
    finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
  return { target, parent,
    send(source: object, data: unknown, origin = 'null') {
      const event = new Event('message');
      Object.defineProperties(event, { source: { value: source }, data: { value: data }, origin: { value: origin } });
      target.dispatchEvent(event);
    },
    get listenerCount() { return listeners.size; },
  };
}

test('client entry imports in SSR without connecting or requiring a browser', async () => {
  assert.equal(typeof window, 'undefined');
  const { connectApp } = await import('../src/client/index.js');
  await assert.rejects(connectApp(), { code: 'sdk.browser_required' });
});

test('production iframe preserves root URLs and trusts only the parent theme source', async t => {
  const { connectApp } = await import('../src/client/index.js');
  const b = browser(t, true, '../');
  const app = await connectApp();
  try {
    assert.equal(app.url('/state?q=1'), 'https://gateway.test/proxy/apps/view/grant/state?q=1');
    assert.equal(app.webSocketUrl('/terminal'), 'wss://gateway.test/proxy/apps/view/grant/terminal');
    for (const path of ['//evil.test/a', 'https://evil.test', '../escape', '/a/../escape', '/%2e%2e/escape', '/%252e%252e/a', '/a%2fb', '/a\\b']) {
      assert.throws(() => app.url(path), { code: 'sdk.invalid_url' });
    }
    assert.equal(app.theme.current, null);
    let updates = 0;
    const off = app.theme.subscribe(() => { updates++; });
    b.send({}, fixture.theme, b.target.location.origin);
    b.send(b.target, fixture.theme, b.target.location.origin);
    b.send(b.parent, { type: 'pioneer.theme', palette: { ...fixture.theme.palette, accent: 'invalid' } });
    assert.equal(updates, 0);
    b.send(b.parent, fixture.theme); // Opaque origin is allowed for the parent.
    assert.equal(app.theme.current?.appearance, 'dark');
    assert.equal(updates, 1);
    off(); b.send(b.parent, fixture.theme);
    assert.equal(updates, 1);
    app.dispose(); b.send(b.parent, { ...fixture.theme, palette: { ...fixture.theme.palette, appearance: 'light' } });
    assert.equal(app.theme.current?.appearance, 'dark');
    assert.throws(() => app.url('/state'), { code: 'sdk.closed' });
  } finally { app.dispose(); }
});

test('direct dev captures early self messages, supplies late subscribers, and isolates repeated connections', async t => {
  const { connectApp } = await import('../src/client/index.js');
  const b = browser(t, false);
  b.target.location.href = 'http://localhost:3000/tools/view';
  b.target.location.origin = 'http://localhost:3000';
  await assert.rejects(connectApp(), { code: 'sdk.base_url_required' });
  const connecting = connectApp({ baseUrl: '/tools/' });
  b.send(b.target, fixture.theme, b.target.location.origin); // Before await/UI mount.
  const first = await connecting;
  const second = await connectApp({ baseUrl: '/tools/' });
  try {
    assert.equal(first.theme.current?.appearance, 'dark');
    assert.equal(second.theme.current, null);
    assert.equal(first.webSocketUrl('/terminal'), 'ws://localhost:3000/tools/terminal');
    let initial = 0;
    first.theme.subscribe(theme => { initial++; assert.equal(theme.appearance, 'dark'); });
    assert.equal(initial, 1);
    b.send(b.target, fixture.theme, 'http://evil.test');
    b.send(b.target, fixture.theme, 'null');
    b.send(b.parent, fixture.theme, b.target.location.origin);
    assert.equal(second.theme.current, null);
    first.dispose();
    assert.equal(b.listenerCount, 1);
    b.send(b.target, { ...fixture.theme, palette: { ...fixture.theme.palette, appearance: 'light' } }, b.target.location.origin);
    assert.equal(first.theme.current?.appearance, 'dark');
    assert.equal(second.theme.current?.appearance, 'light');
    let received: string | undefined;
    const off = second.theme.subscribe(theme => { received = theme.appearance; });
    assert.equal(received, 'light');
    off(); second.dispose();
    const next = await connectApp({ baseUrl: '/tools/' });
    assert.equal(next.theme.current, null); // There is no fabricated handshake/cache.
    next.dispose();
  } finally { first.dispose(); second.dispose(); }
});

test('explicit root overrides base href while cross-origin roots fail closed', async t => {
  const { connectApp } = await import('../src/client/index.js');
  browser(t, true, '../');
  await assert.rejects(connectApp({ baseUrl: 'https://evil.test/' }), { code: 'sdk.invalid_url' });
  const app = await connectApp({ baseUrl: '../assets/' });
  try { assert.equal(app.url('/state'), 'https://gateway.test/proxy/apps/view/grant/assets/state'); }
  finally { app.dispose(); }
});
