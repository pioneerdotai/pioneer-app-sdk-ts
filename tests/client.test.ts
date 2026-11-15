import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connectApp } from '../src/client/index.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/protocol.json', import.meta.url), 'utf8'));
test('view-scoped URLs and source-checked themes work without ambient origin or storage', async () => {
  const saved = new Map(['window', 'document', 'CSS'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const parent = {};
  const target = Object.assign(new EventTarget(), { parent, location: { href: 'https://gateway.test/proxy/apps/view/grant/nested/page' } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { supports: (_property: string, color: string) => /^#[0-9a-f]{6}$/.test(color) } });
  const send = (source: object, data: unknown) => {
    const event = new Event('message');
    Object.defineProperties(event, { source: { value: source }, data: { value: data }, origin: { value: 'null' } });
    target.dispatchEvent(event);
  };
  try {
    await assert.rejects(connectApp(), { code: 'sdk.base_url_required' });
    const app = await connectApp({ baseUrl: '../' });
    assert.equal(app.url('/state?q=1'), 'https://gateway.test/proxy/apps/view/grant/state?q=1');
    assert.equal(app.webSocketUrl('/terminal'), 'wss://gateway.test/proxy/apps/view/grant/terminal');
    for (const path of ['//evil.test/a', 'https://evil.test', '../escape', '/a/../escape', '/%2e%2e/escape', '/%252e%252e/a', '/a%2fb', '/a\\b']) {
      assert.throws(() => app.url(path), { code: 'sdk.invalid_url' });
    }
    assert.equal(app.theme.current, null);
    let updates = 0;
    const off = app.theme.subscribe(() => { updates++; });
    send({}, fixture.theme);
    send(parent, { type: 'pioneer.theme', palette: { ...fixture.theme.palette, accent: 'invalid' } });
    assert.equal(updates, 0);
    send(parent, fixture.theme);
    assert.equal(app.theme.current?.appearance, 'dark');
    assert.equal(updates, 1);
    off(); send(parent, fixture.theme);
    assert.equal(updates, 1);
    app.dispose(); send(parent, { ...fixture.theme, palette: { ...fixture.theme.palette, appearance: 'light' } });
    assert.equal(app.theme.current?.appearance, 'dark');
    assert.throws(() => app.url('/state'), { code: 'sdk.closed' });
    target.location.href = 'http://gateway.test/p/view/root/';
    target.parent = target;
    const standalone = await connectApp({ baseUrl: './' });
    assert.equal(standalone.webSocketUrl('socket'), 'ws://gateway.test/p/view/root/socket');
    send(parent, fixture.theme);
    assert.equal(standalone.theme.current, null);
    standalone.dispose();
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
