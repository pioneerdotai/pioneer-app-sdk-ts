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
`SDK PR checks` builds and tests pull requests targeting main.
`Publish SDK to npm` independently builds and publishes the tagged source for
version tags such as `v0.1.1`. It does not run tests or require PR results.
Pushes and merges to main do not start either workflow.

```ts
import { connectApp } from '@pioneercompany/app-sdk/client';
const app = await connectApp({ baseUrl: './' }); // Only for a root document!
// For nested documents render an authenticated <base href="../.../"> or pass
// the exact view root. Do not infer a grant token from pathname segments.
const unsubscribe = app.theme.subscribe(theme => {
  document.body.style.background = theme.colors.background;
});
const stateUrl = app.url('/state');
const terminalUrl = app.webSocketUrl('/terminal');
unsubscribe();
app.dispose();
```

Inside Pioneer Desktop, move the current application view without reloading it:

```ts
await app.view.setPlacement('fullscreen');
await app.view.setPlacement('bottom');
await app.view.setPlacement('right');
```

`fullscreen` fills Pioneer's application area using the expanded placement; it does not change OS window fullscreen. Opening from the Apps
page starts in this placement. The method works in installed and direct dev
views on a Desktop version supporting the presentation bridge. It requires no
backend credentials. Calls resolve after Desktop applies the placement; an
unavailable host times out after five seconds (`sdk.view_timeout`). At most 16
calls may be pending per client (`sdk.view_overloaded`); `dispose()` rejects
remaining calls with `sdk.closed`. Invalid placement rejects with
`sdk.invalid_placement`; a synchronous transport failure is `sdk.view_unavailable`.

To close this application view:

```ts
app.view.close();
```

This closes the current presentation. The application stays installed and its
backend remains managed by Gateway, following the Desktop view
lifecycle. `close()` sends a request and returns `void`: it cannot acknowledge
completion to a JavaScript context being destroyed. Save state before calling
it. It throws `sdk.closed` after disposal or `sdk.view_unavailable` on a
synchronous transport failure. A browser or older Desktop without the bridge
may ignore the request. `app.dispose()` only releases the SDK client; it does
not close the view.

`connectApp` installs its listener synchronously before its promise is awaited.
Call it during browser module initialization, before iframe load or the dev
page's DOMContentLoaded. SSR imports are safe; connecting requires a browser.
Theme starts null. SDK 0.2 exposes the complete native theme through
`app.theme.current` and `app.theme.subscribe`: `mode`, all resolved `colors`,
`light_theme`, `dark_theme`, fonts, radii, tokens, highlighting and other settings.
For example, use `theme.colors.success`, `theme.colors.tab_bar`, or
`theme.dark_theme.colors["base.blue.light"]`. The whole nested snapshot is cloned
and deep-frozen, including unknown future fields; it is never reduced to a list
of selected keys. See [all fields and the 0.1 migration](docs/theme.md).

Iframes accept their parent, including opaque origins; direct pages require self
and exact origin. Late subscribers receive the current snapshot immediately.
Connections are independent and disposable. No theme handshake/resend request or
DOM/style mutation is performed. Theme grants no backend authority. SDK 0.2
requires the updated Desktop theme bridge; old flat `palette` messages are ignored.
URL methods return strings, reject external/protocol-relative/traversal paths,
and interpret a leading slash relative to the view root. For a dev app opened
in Pioneer Desktop, call `connectApp()`. Desktop supplies the Gateway view root
for API and WebSocket URLs. The page, assets, and hot reload use the dev server.
Outside Pioneer, supply the base element or `baseUrl` as usual. No
cookies/localStorage are used. Keep server configuration out of browser code.

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

With `NODE_ENV=development` and no explicit bootstrap, the server SDK reads
`credential.json` in the project directory and uses `.pioneer-data` unless
`APP_DATA` or `appData` is set. Run `pioneer dev app add` before starting the dev
server and save its JSON there. Exclude the file from Git and browser assets.

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


### Server-side rendering

Gateway installations that advertise `host.render` let the app's backend render
PNG and PDF without bundling a browser.

```ts
const { data: png, metadata } = await app.host.render.screenshot({
  path: "/agent-render",
  input: { snapshot, range: "A1:H20" },
});
const pdf = await app.host.render.pdf({ html });
```

The screenshot page implements `window.__pioneerRender.prepare(input)` to return
the viewport dimensions and `window.__pioneerRender.capture()` to return
`{ clip: { x, y, width, height }, metadata }`. Gateway resolves the path in the
current app execution. Both operations accept an optional `AbortSignal`.

## Profiles in an open app view

`app.profiles.resolve({ includeSelf: true })` returns the signed-in user's
profile in `self`. Pass `identities: [{ type, id }]` to resolve up to 64 people
or agents by ID. The response includes the accessible matches in `profiles`.
Each profile has `type`, `id`, `displayName`, `nickname`, and `avatarRevision`.

```ts
const app = await connectApp()
const { self } = await app.profiles.resolve({ includeSelf: true })
const avatar = self ? app.profiles.avatarUrl(self) : null
```

Use the returned avatar URL with `crossorigin="anonymous"` and
`referrerpolicy="no-referrer"`. The profile API uses the current app view
grant in both installed and development views. Cache the results in memory
for the lifetime of the open view.
