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
