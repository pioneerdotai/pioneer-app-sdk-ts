# @pioneercompany/app-sdk

SDK for the current Pioneer Apps contract. ESM and CommonJS, Node.js 22+
server; browser client with no React or Node imports. No package root export.
Implementation coverage: [contract table](docs/coverage.md).
For registry setup and installation with Bun/npm/pnpm/Yarn, see
[npm publishing](docs/publishing.md). The public npm package is
`@pioneercompany/app-sdk`; older local archives used `@pioneer/app-sdk`.

```sh
bun add @pioneercompany/app-sdk
# or: npm install @pioneercompany/app-sdk
```

Consumers do not need a token or a custom registry for this public package.
GitHub Actions publishes through npm Trusted Publishing (OIDC), without a stored
publish secret. First-time package creation and the exact npm trust settings are
documented in the publishing guide.
PRs and merges to main only build/test. Publication requires a tag such as
`v0.1.1` that matches package.json's version; it publishes the stable version `0.1.1`.

```ts
import { connectApp } from '@pioneercompany/app-sdk/client';
const app = await connectApp({ baseUrl: './' }); // Only for a root document!
// For nested documents render an authenticated <base href="../.../"> or pass
// the exact view root. Do not infer a grant token from pathname segments.
const unsubscribe = app.theme.subscribe(theme => {
  document.body.style.background = theme.background;
});
const stateUrl = app.url('/state');
const terminalUrl = app.webSocketUrl('/terminal');
unsubscribe();
app.dispose();
```

`connectApp` installs its listener synchronously before its promise is awaited.
Call it during browser module initialization, before iframe load or the dev
page's DOMContentLoaded. SSR imports are safe; connecting requires a browser.
Theme starts null. Iframes accept the parent window, including opaque origins;
direct dev pages accept their own window with exact origin matching. subscribe
immediately delivers an already known palette, then future updates. Connections
are independent and disposable. There is no handshake or resend request: a late
connection cannot recover a missed message. Theme grants no backend authority.
SDK does not mutate DOM/styles; applications apply data via their own state.
URL methods return strings, reject external/protocol-relative/traversal paths,
and interpret a leading slash relative to the configured view root. A base URL
is required (explicit option or HTML base element), including outside Pioneer.
No cookies/localStorage are used. Never put server configuration in browser code.
For a direct root dev server use `connectApp({baseUrl:'/'})`; for mounted paths
use the explicit mount root or base href. There is no process.env mode switch.

```ts
import { createAppServerContext, nodeRequestHeaders } from '@pioneercompany/app-sdk/server';
const app = await createAppServerContext();
// In your existing HTTP handler:
const context = app.authenticateRequest(nodeRequestHeaders(req));
console.log(context.user.id); // Trusted only after credential authentication.
// In your readiness handler, before returning readiness:
app.authenticateServiceRequest(nodeRequestHeaders(req));
// Same adapter/authenticateRequest in your existing upgrade handler.
await app.close();
```

SDK reads `PIONEER_BOOTSTRAP` and `APP_DATA`. It does not start a server or own the
process. Missing bootstrap fails closed. `bootstrap`, `bootstrapPath`, `appData`
options support explicit configuration with the same validation, not an auth
bypass. Contexts and errors do not serialize credentials. Treat input bootstrap
objects and environment as secrets; the SDK cannot erase caller-owned copies.

```ts
const terminal = await app.host.pty.create({ cols: 120, rows: 30,
  command: ['/bin/sh'], cwd: '/tmp' }); // Runs on the Gateway host OS account.
const subscription = await terminal.subscribe({
  after: 0,
  onOutput(frame) {
    void consume(frame.bytes).then(() => frame.ack()).catch(handleError);
    // ACK declares all data through frame.next consumed; serialize your consumer.
    // frame.failed and frame.exitStatus describe supervision/process state.
  },
  onError: handleError,
});
await terminal.write('pwd\n'); // Accepted by Gateway, not proof of shell execution.
await terminal.resize({ cols: 100, rows: 28 });
subscription.dispose(); // Stops output, keeps process and lease.
await terminal.close(); // Destroys process.
await app.close(); // Destroys remaining owned PTYs and releases transport.
```

Handles also provide `read({after,signal?})` for bounded legacy snapshots,
`keepalive({signal?})` for explicit maintenance and `onChanged(listener)` for
legacy invalidation hints. Gateway suppresses changed after any stream subscribe
on the connection. read does not ACK a stream. `frame.streamId` identifies replay
generations so an adapter can discard old queued receipts and trim accepted data.

The application must authorize access to handles; user identity does not cause
Gateway PTY impersonation. One context is shared by a backend execution, while
client themes belong to individual views. Use `PioneerError.code` and `source`
(`sdk` or `host`) for decisions, never parse messages. Host codes are preserved;
SDK codes cover invalid configuration, unauthorized/missing user, unavailable
capability, bounds, cancellation, ambiguous delivery, stale receipts, blocked
input, unconfirmed lease and incomplete cleanup. Unsubscribe is local: it does
not reset the shared connection or interrupt another PTY's input. Residual remote
output is bounded until stream replacement, PTY close or disconnect. A confirmed
ACK advances credit before the next output message, including a synchronous burst.
Transient keepalive failures have a finite recovery budget without blocking
ordinary operations immediately. Unknown creates and failed closes cause
context close to report `sdk.cleanup_incomplete`, even after local teardown.
See [the contract](docs/contract.md) for precise
limits, retry, ACK, replay, cancellation and ownership semantics.

Prepared commands for a later authorized review environment:

- `bun install --frozen-lockfile`: install the pinned build/test dependencies.
- `npm run build`: emit ESM/CJS, declarations/maps and the CJS package marker.
- `npm run typecheck`: compilation checks without emit.
- `npm test`: Node test runner through tsx, source tests without a build.
- `npm run test:package`: import/require acceptance of the already built package.

There are no lifecycle hooks or package-root export. Runtime dependency `ws`
is server-only; TypeScript/tsx/types are development dependencies. Browser
bundlers must select the explicit client entry. Exports point at build output;
a source checkout must be built before importing by package name. Sources are
included for source/declaration maps. Examples
are snippets, not a runnable demonstration application.

See [Terminal integration](docs/terminal-integration.md) for a relative tarball
dependency compatible with its CJS server and physical-root packaging rules,
both locally and in CI without a neighboring checkout. Direct dev UI does not
provision backend Host API authority; Terminal's local backend remains separate.

Current-contract implementation is complete by source audit; compilation,
package tracing and runtime acceptance require external verification.
Streaming has no capability subversion on Gateway;
older `host.pty` implementations may reject subscribe. New dev registration,
Terminal integration and future Python/Rust implementations are out of scope.
