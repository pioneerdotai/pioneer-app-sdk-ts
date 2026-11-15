# Manual review record

Baseline: 3336d28 on feat/initial-sdk. External review found five real defects
missed by the initial manual review. This revision corrects them; no executable
verification, dependency installation, type checking or test run is claimed.

## Contract review

Read Gateway protocol/src/jsonrpc.rs (RequestId: exactly 21 Unicode characters),
gateway/src/host_api/mod.rs (deserialize before dispatch, reply before later
output, credential/revocation), host_api/stream.rs (connection-local stream
replacement, cumulative ACK, 64 KiB / 64 data frames, close removes stream), and
host_api/pty.rs (idempotent create keys, accepted input sequences, alive:true,
closed:true, five-minute lease). No neighboring repository was edited.

## Implementation review

- RPC IDs: 21 ASCII base64url characters, 126 random bits, pending collision
  exclusion. Create keys and stream IDs keep UUIDs under their separate limits.
- Unsubscribe: removes callbacks, fences receipts and stops credit locally;
  no transport reset, no consumption of another subscription's retry budget.
  Residual streams remain bounded, are replaced by subscribe for the same PTY,
  or removed by close/disconnect. PTY process/lease ownership is unchanged.
- ACK: transport applies validated response effects synchronously before the
  next message callback, not in a Promise continuation. Sent ACKs grant no local
  credit until acknowledged:true. Partial cumulative confirmation removes only
  consumed frame ends. Stale generations cannot advance cursor/credit. The
  original 64 KiB and 64 data-frame limits remain; no automatic consumption.
- Keepalive: one in flight; temporary local/transport/capacity failures permit
  ordinary operations and up to three consecutive failed heartbeats. Success
  resets the budget. A monotonic 240-second confirmation bound remains below
  Gateway's lease. Definitive host errors stop immediately; exhausted recovery
  reports sdk.lease_unconfirmed (not host.session_expired). Close/revocation
  aborts the heartbeat and removes its listener/timer; subscription receives
  the definitive failure. No shell recreation or endless recovery.
- Cleanup: context tracks ambiguous creates across same-key retry, clearing only
  on a validated session response. Pre-send refusal does not mark ambiguity.
  Invalid successful-create responses also retain uncertainty. Unknown creates
  consume bounded context capacity. Failed PTY close remains owned and keeps
  its idempotent rejected close promise; only closed:true releases ownership.
  Context close waits for creates, disposes all known handles and transport,
  and rejects cleanup_incomplete for any unresolved create or failed close.
  Concurrent create/context-close uses the same handle and close promise.

## Regression authoring and final review

The test peer checks Gateway's request ID boundary, handshake headers and create
key deduplication, allocates distinct sessions, and tracks streams per socket.
Tests observe public handles and wire traffic, never SDK private state. A
controlled ws message-emission burst makes the ACK/next-output race independent
of TCP timing; timer mocks drive heartbeat obligations without real delays.
Existing cursor-expiry, input ambiguity, cancellation and overflow cases remain.
The authoring pass uses test-audit; production changes are staged as its baseline
and stayed read-only during that pass (git diff against the index was empty for
src, README, docs and fixtures). Only tests/pty.test.ts changed during that pass.
No baseline fail/pass execution is allowed.

Final source/diff review covers the interaction of lease stop, unsubscribe,
ACK fencing, create cancellation/retry and context ownership. Package exports,
client/server boundary, dependencies and release settings remain unchanged.
No new transport/service, framework, runtime, or language SDK is introduced.
Tests and declaration/package compatibility still require external validation.

Remaining limits: unsubscribe cannot eagerly delete a remote stream, only stop
credit; an unknown create cannot be discovered, and failed close is not retried
by repeated close calls. Cleanup uncertainty remains explicit until context
teardown, with Gateway lease/revocation as fallback rather than confirmed deletion.
The lease recovery budget can stop a still-live PTY conservatively. Handshake
401/403 is terminal; bare connection loss alone does not identify revocation.
Streaming capability subversion, dev integration and other language SDKs remain
out of scope. Dependencies, exports and client sources were not changed.

## Test synchronization follow-up (baseline 4e248ab)

### External execution, supplied by the reviewer

The reviewer closes the five previous production-code findings after static
review. With Node.js 25.9.0, ws 8.23.0 and tsx 4.23.15, the command
`/opt/homebrew/bin/node --import tsx --test tests/*.test.ts` reported 22 passing
scenarios and an unhandled sdk.delivery_unknown rejection in `temporary keepalive
error and transport loss recover without replacing the shell`. The process did
not exit. A repeat full run failed the same way; an isolated run of that scenario
passed. Dependencies were installed externally with bun install --ignore-scripts
--no-save; the reviewer reported a clean Git tree. These are external results,
not commands executed or reproduced in this follow-up.

### Source analysis and changes, without execution

The old global close observer accepted every WebSocket absent from the current
peer's *server-side* connection list. It could therefore accept a late client
close from an earlier peer and release the recovery barrier before the intended
client closed. A resize could then be sent over the dying connection and reject
with delivery_unknown. The barrier did not observe that rejection while awaiting
a request that might never arrive. This source-level causal path matches the
suite-only report; the exact foreign socket was not independently traced here.
No independent production transport defect was established.

The peer now tracks only client WebSockets whose public URL equals its endpoint,
and correlates an RPC response ID with the server connection that received the
request. Disconnect terminates that exact server socket and awaits close on both
sides. It does not classify arbitrary global close events, read SDK private
fields, synthesize a disconnect, or replace the real recovery test.

The barrier races its cancellable channel wait against an immediately observed
operation result. An operation failure propagates its original error; finally
cancels/removes the abandoned waiter. The new regression closes one public PTY,
expects its barrier to reject with sdk.closed, then completes another PTY's
barrier on the same channel. A retained waiter would steal the latter request.

Peer close is idempotent. Normal teardown awaits SDK shutdown and actual client,
server-WebSocket and listening-server close events. Test hooks also drain on a
failed/cancelled body: stop admission, terminate sockets, settle SDK shutdown,
then include any handshake already queued when teardown began. Channels belong
to TestContext, reject/release waiters at teardown and remove abort listeners.
Their original rejected promises remain rejected for callers; immediate internal
observation only prevents a cancelled body from leaving an unhandled rejection.
An SDK-close rejection explicitly owned by a test remains observable to that test;
a hook-initiated unexpected close failure is reported by the hook.

Manual review covered normal/rejected close, queued handshakes, mock lifetime,
RPC response correlation, the barrier's losing race branch and repeated teardown.
The test-audit pass changed only tests/pty.test.ts; source/configuration diff stayed
empty throughout. This documentation update follows that test-only pass.
Production sources, public API, dependencies, Gateway and Terminal are unchanged.
No sleeps or larger timeouts were introduced. No dependencies, tests, builds,
type checks, linters, applications or executable checks were run in this pass.
Whether the complete suite now passes and exits normally remains for external
validation; neither outcome is claimed here.

## Current-contract completion (baseline ec409bb)

Source audit re-read SDK implementations, Terminal server.ts, dev-server.ts,
lib/gateway-host.ts, lib/host-theme.ts, lib/terminal-sessions.ts, app/layout.tsx,
package.json and scripts/pioneer/{build,trace-runtime}.mjs. Read Pioneer
crates/desktop-apps/src/lib.rs, crates/gateway/src/host_api/{mod,pty,stream}.rs,
message/apps/runtime.rs and transport/http/apps.rs. docs/coverage.md records the
before/after contract matrix; neither prior reports nor tests substitute for it.
Working tree was clean; work continues on a new feat/complete-app-contract branch.
Also re-read message/apps/{dev,ui}.rs: direct dev URLs are durable authoring
registrations, with no backend execution bootstrap/Host credential in their view
response. Installed bootstrap issuance remains in runtime.rs.

Client block review: direct dev uses self+origin, iframe uses parent source;
no environment switch, authority, DOM/hydration mutation, auto-connect on SSR,
handshake or timing heuristic. Calling connectApp early installs synchronously;
late UI subscribers get known current synchronously. Independent instances
release only their listeners. A late *connection* cannot request missing theme.
Explicit/base roots remain required, preserving prefix and containment.

Server/PTY block review: Gateway admits exactly eight RPC operations and two
notification kinds; public read/keepalive/onChanged now complete that surface.
Legacy heads are hints, not EOF or reliable delivery; after streaming Gateway
suppresses changed globally on that connection. Snapshot reads never ACK input
or output. streamId is the existing wire identity, suitable for consumer replay
queue fencing; receipt ACK remains explicit. Added generation check after the
subscribe response: if the same receive stack reports a disconnect, the initial
or replacement watch must use its finite retry budget instead of returning a
now-dead subscription. Initial watch serializes with recovery, sharing that
budget. No reconnect creates a PTY or resends arbitrary input. Existing unknown
create/failed close accounting, unsubscribe isolation, bounded ACK/input windows,
leases and revocation remain in place.

Packaging block review: Terminal leaves dependencies external in server.cjs and
rejects physical paths outside its root. Added CJS output plus a static package
marker copied only by the explicit build command; import/require export branches
have matching declarations. ESM remains available and client dependency graph
contains only browser code + shared errors. No new runtime dependency, generated
code, vendoring or library patch. Maps resolve through packaged source. An
installed tarball with relative vendor dependency/consumer lock avoids links and
neighbor-checkout requirements. No publication or consumer edit is performed.
The source dependency lock is not fabricated: release toolchain locking and
actual Terminal trace/build acceptance remain external steps.

Prepared regression scope: direct/iframe source validation, early messages and
late subscribers, repeated/disposed connections, explicit/base URLs, inert SSR
import; snapshot/legacy hints/explicit keepalive without implicit ACK; pixel
resize and immediate subscribe-response transport failure; built ESM/require
exports and absence of a root entry. Existing multi-PTY, slow-consumer, ACK burst,
replay, cancellation and cleanup cases are retained, not duplicated. Test-audit
is applied only to the subsequent test-only pass with implementation staged as
its read-only baseline. No new execution result is asserted.

Final completion review: reviewed the complete staged implementation diff and
new tests without running them. The test-only pass preserved the implementation
baseline (empty unstaged source/config/doc diff); it ended before final source
corrections. Those corrections stop remaining callbacks when a consumer disposes
its view/PTY during dispatch, validate resize's resized:true response, and align
stream exit-status bounds with the existing u32 wire value. Re-read those paths
and the watch-generation/ACK interaction after correction. No duplicate service,
transport or app-local PTY was introduced. The shared client graph remains free
of Node/ws/server configuration; only server output/transport gained Host methods.

Remaining platform limits are concrete: desktop-apps/src/lib.rs:410-453 has only
postMessage sends, no palette request handler; late connects therefore cannot
force initial theme delivery. host_api/stream.rs:45-120 has no unsubscribe method;
credit withholding plus replacement/close is the existing bounded solution.
host_api/mod.rs:175 rejects Origin and requires execution Bearer authority; a
registered dev URL cannot become an authorized local Host backend. No capability
subversion, process-cwd event, exactly-once downstream display or unknown-PTY
lookup exists in this Host contract. These limits and the consumer's replay
acceptance responsibilities are explicit in the contract/integration documents.

Source-level completion covers the current app surface; it is not evidence of
successful compilation, package emission, dependency trace or live integration.
Not run: dependency installation/updates, tests (including the separate package
acceptance suite), ESM/CJS builds, TypeScript/type checks, linters, formatting
checks, npm pack/publish, applications, Gateway, dev servers, cargo checks/builds/
clippy, generators or indirect executable verification. External reviewers must
perform the approved build/test/pack/consumer-trace acceptance next.
