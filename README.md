# @pioneer/app-sdk

First review candidate for production Pioneer applications. ESM, Node.js 22+
server; browser client with no React or Node imports. No package root export.
No installation, compilation, tests or examples have been executed for this draft.

```ts
import { connectApp } from '@pioneer/app-sdk/client';
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

`connectApp` resolves immediately. Theme starts at null. It listens only to the
parent window, including opaque-origin WebViews. Install before load to receive
the shell's existing theme message. Outside Pioneer no theme is synthesized.
URL methods return strings, reject external/protocol-relative/traversal paths,
and interpret a leading slash relative to the configured view root. A base URL
is required (explicit option or HTML base element), including outside Pioneer.
No cookies/localStorage are used. Never put server configuration in browser code.

```ts
import { createAppServerContext, nodeRequestHeaders } from '@pioneer/app-sdk/server';
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

The application must authorize access to handles; user identity does not cause
Gateway PTY impersonation. One context is shared by a backend execution, while
client themes belong to individual views. Use `PioneerError.code` and `source`
(`sdk` or `host`) for decisions, never parse messages. Host codes are preserved;
SDK codes cover invalid configuration, unauthorized/missing user, unavailable
capability, bounds, cancellation, ambiguous delivery, stale receipts, blocked
input and incomplete cleanup. See [the contract](docs/contract.md) for precise
limits, retry, ACK, replay, cancellation and ownership semantics.

Prepared commands for a later authorized review environment:

- Install dependencies using npm (creates a lockfile; none generated here).
- `npm run build`: emit ESM, declarations/maps in dist using TypeScript.
- `npm run typecheck`: compilation checks without emit.
- `npm test`: Node test runner through tsx, source tests without a build.

There are no lifecycle hooks and no CJS/root export. Runtime dependency `ws`
is server-only; TypeScript/tsx/types are development dependencies. Browser
bundlers must select the explicit client entry. Exports point at build output;
a source checkout must be built before importing by package name. Examples
are snippets, not a runnable demonstration application.

This is ready for external review, not a claim of verified compilation or
runtime compatibility. Streaming has no capability subversion on Gateway;
older `host.pty` implementations may reject subscribe. New dev registration,
Terminal integration and future Python/Rust implementations are out of scope.
