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
