// Separate acceptance suite: requires explicit build first. Never silently skip
// missing output, and never run a build as a side effect of a test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
test('built package supports ESM and external CJS consumers without a root export', async () => {
  const client = await import('@pioneer/app-sdk/client');
  const server = await import('@pioneer/app-sdk/server');
  const cjsClient = require('@pioneer/app-sdk/client');
  const cjsServer = require('@pioneer/app-sdk/server');
  assert.equal(typeof server.createAppServerContext, 'function');
  assert.equal(typeof cjsServer.nodeRequestHeaders, 'function');
  for (const entry of [client, cjsClient]) {
    await assert.rejects(entry.connectApp(), { code: 'sdk.browser_required' });
  }
  assert.throws(() => require('@pioneer/app-sdk'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  await assert.rejects(import('@pioneer/app-sdk'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});
