# Connecting the completed SDK to Terminal

These are instructions for the separate Terminal integration, not changes to
Terminal. Source contracts checked: package.json build:server uses
`bun build --target=node --format=cjs --packages=external`; the runtime tracer in
scripts/pioneer/trace-runtime.mjs rejects real paths outside Terminal's root.
Do not weaken either constraint or use a linked sibling checkout as a production
dependency. The SDK's require export selects CommonJS with a local package.json
marker; import selects ESM. Both are generated from the same TypeScript sources.
Use one module mode per backend; mixing modes creates separate Error constructors.

## Artifact preparation and dependency consumption

Commands below are for a later authorized build, and were NOT executed here.
From the SDK source checkout, using an approved/pinned dependency toolchain:

```sh
npm run build
npm run test:package
npm pack --ignore-scripts
```

Build emits dist (ESM/declarations/maps), dist-cjs (CommonJS/declarations/maps)
and its type:commonjs marker. Pack includes both outputs, source files for maps,
docs and fixtures. No root export, bundled ws, lifecycle hooks or publishing.
Run the build explicitly before pack: --ignore-scripts intentionally cannot
prepare missing output. The dist directories are generated and not committed.
The source checkout has no newly generated dependency lockfile; generating and
reviewing it, installation and artifact verification belong to external release
acceptance. Do not claim bit-reproducible compilation from unlocked tool ranges.

For local SDK development, copy the resulting tarball into Terminal as
`vendor/pioneer-app-sdk-0.1.0.tgz`, and use this relative dependency:

```json
{ "dependencies": { "@pioneer/app-sdk": "file:vendor/pioneer-app-sdk-0.1.0.tgz" } }
```

Install it with Terminal's package manager in the separate integration step;
verify that it extracts into Terminal/node_modules rather than links outside it.
Avoid npm link, workspace links and file:../pioneer-app-sdk-ts. After SDK edits,
rebuild/repack, replace the tarball and refresh the consumer lock/integrity and
installation so caches do not reuse an older archive. Review generated lock
changes. No absolute developer paths are required.

For CI/production, commit that reviewed tarball (or fetch the exact immutable
artifact by digest into the same vendor path) together with the relative
dependency and updated Terminal lockfile. Terminal's existing
`bun install --frozen-lockfile` then consumes it without a neighboring checkout.
The production image/artifact includes traced installed dependencies, not an SDK
checkout. Alternatively use an exact registry release later, after a separately
authorized publication. This task neither publishes nor changes Terminal's build.

The CJS server keeps require('@pioneer/app-sdk/server') external, so the existing
NFT tracer must include dist-cjs and runtime ws in Terminal's own node_modules.
The client uses import('@pioneer/app-sdk/client'); browser bundling never reaches
server code, Node APIs or bootstrap credentials. The separate package acceptance
test covers real import/require resolution after building. Consumer build/trace
acceptance still has to run in Terminal; this is a source-verified integration
path, not an executed packaging result.

## Consumer mapping (no Gateway protocol left in the application)

| Existing Terminal seam | SDK operation / application responsibility |
| --- | --- |
| server.ts bootstrap + authorized/requestOwner | createAppServerContext, nodeRequestHeaders, authenticateRequest; service auth for healthz |
| lib/host-theme.ts | Early browser connectApp, theme.current and immediate subscribe; keep state in the application's store |
| GatewayHost.spawn | Start one app.host.pty.create promise per SpawnPty; return SessionPty immediately, defer operations to that promise |
| TerminalSize | cols, rows, width→pixelWidth, height→pixelHeight |
| SessionPty.write | await handle.write(data); ACK is Gateway acceptance, not shell completion |
| SessionPty.resize | handle.resize; optionally coalesce desired sizes in adapter, report rejection |
| events.data | Deliver stream bytes to PtyOutput's bounded acceptance boundary, then explicitly await frame.ack |
| pause/resume | Stop/resume draining the adapter's bounded frame queue; withhold ACK while paused |
| events.cwd | Current Host protocol has no cwd event; Terminal can label 'Gateway shell', not claim a measured cwd |
| events.exit | failed is supervision failure; exitStatus with next===end signals final output/process completion; close owned handle |
| dispose(kill) | Fence adapter callbacks and cancel pending subscription setup; close its owned handle once create settles (Terminal's existing Gateway adapter closes for either kill value) |
| execution shutdown | await app.close; report cleanup_incomplete, do not label remote cleanup confirmed |

Adapter output state needs a highest *accepted* byte cursor and current
frame.streamId. On a new streamId discard old queued, unconsumed receipts; SDK
will replay from its confirmed consumed cursor. Skip any prefix already accepted
by the downstream owner before an ACK was lost, using frame.after/next. Do not
throw away a new suffix and do not ACK ahead of acceptance. Keep at most 64 KiB
of unconsumed data and 64 data frames plus bounded process-state events. Ignore
sdk.stale_receipt on an old stream's pending ACK only after fencing/discarding
that stream. Other errors must reach the owner. No JSON-RPC, retry loop, lease
interval, authentication, bootstrap parser or WS connection belongs in this
adapter. Exactly-once presentation is not a Gateway guarantee; this accepted
cursor/deduplication policy belongs to the downstream application.

## Production and dev

Installed execution: connect the backend with real PIONEER_BOOTSTRAP/APP_DATA;
render an escaped base href from the authenticated pioneer-app-base-path header.
Client connectApp() consumes that base without guessing the grant or proxy
prefix. HTTP and upgrade requests use the same authenticated principal adapter.

Direct dev URL: connectApp({baseUrl:'/'}) for a root dev server, or the explicitly
configured dev mount root. Self-window messages must match location.origin;
ordinary fetch/WS uses that URL. No credentials are needed for theme/URL APIs.
Do not instantiate a trusted server context without production authority. Existing
Terminal dev-server.ts/local-pty.ts remains its application-owned local backend
with its own origin/admission rules. Registering pioneer dev app add . --url ...
only registers UI/components; it does not issue a local Host API credential.
