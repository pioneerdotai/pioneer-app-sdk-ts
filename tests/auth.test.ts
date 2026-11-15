import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAppServerContext, nodeRequestHeaders, PioneerError } from '../src/server/index.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/protocol.json', import.meta.url), 'utf8'));
const code = (expected: string) => (error: unknown) => error instanceof PioneerError && error.code === expected;
const headers = (...rawHeaders: string[]) => nodeRequestHeaders({ rawHeaders });

test('identity needs independent proxy authority, readiness does not need a user, duplicates fail closed', async () => {
  const app = await createAppServerContext({ bootstrap: fixture.bootstrap, appData: '/data' });
  try {
    assert.throws(() => app.authenticateRequest(headers('pioneer-app-user-id', fixture.user_id)), code('sdk.unauthorized'));
    const credential = fixture.bootstrap.ui_proxy.credential;
    const service = headers('Pioneer-App-Execution-Credential', credential);
    app.authenticateServiceRequest(service);
    assert.throws(() => app.authenticateRequest(service), code('sdk.user_missing'));
    const trusted = app.authenticateRequest(headers('pioneer-app-execution-credential', credential, 'pioneer-app-user-id', fixture.user_id));
    assert.equal(trusted.user.id, fixture.user_id);
    assert.throws(() => app.authenticateServiceRequest(headers('pioneer-app-execution-credential', credential, 'Pioneer-App-Execution-Credential', credential)), code('sdk.unauthorized'));
    assert.throws(() => app.authenticateRequest(headers('pioneer-app-execution-credential', 'b'.repeat(64), 'pioneer-app-user-id', fixture.user_id)), code('sdk.unauthorized'));
    assert.ok(!JSON.stringify(app).includes(credential));
    await assert.rejects(app.host.pty.create({ cols: 80, rows: 24 }), code('sdk.capability_unavailable'));
  } finally { await app.close(); }
  assert.throws(() => app.authenticateServiceRequest(headers()), code('sdk.closed'));
});

test('invalid bootstrap is rejected without reflecting supplied credentials or parse errors', async () => {
  const secret = 'sentinel-secret-do-not-reflect';
  for (const bootstrap of [null, {}, { ...fixture.bootstrap, ui_proxy: { credential: secret } },
    { ...fixture.bootstrap, host_api: { endpoint: 'https://wrong/', credential: 'b'.repeat(64), capabilities: ['host.pty'] } },
    { ...fixture.bootstrap, host_api: undefined }]) {
    await assert.rejects(createAppServerContext({ bootstrap, appData: '/data' }), error => {
      assert.ok(error instanceof PioneerError);
      assert.equal(error.code, 'sdk.invalid_bootstrap');
      assert.ok(!String(error).includes(secret));
      assert.ok(!JSON.stringify(error).includes(secret));
      return true;
    });
  }
  await assert.rejects(createAppServerContext({ bootstrap: fixture.bootstrap, appData: 'relative' }), code('sdk.invalid_app_data'));
  await assert.rejects(createAppServerContext({ bootstrapPath: '/nonexistent-pioneer-sdk-fixture/bootstrap', appData: '/data' }), code('sdk.invalid_bootstrap'));
});
