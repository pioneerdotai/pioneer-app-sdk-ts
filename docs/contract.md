# Application contract, revision 1 (SDK document, not a wire version)

This is a language-independent description of the existing production protocol.
Python and Rust implementations may own the entire application including its UI.
They do not need TypeScript. A browser view needs an equivalent theme listener
and URL resolver, potentially installed by a future framework adapter.
Runtime and language are separate concerns; theme is per view, never per server.

## Authority and configuration

Gateway writes PIONEER_BOOTSTRAP (absolute file path, JSON, maximum 16384 bytes).
Required execution_id is 21 URL-safe identifier characters; ui_proxy.credential
is 64 lowercase hex characters. host_api is null or endpoint, credential,
capabilities. ui_base_path is currently `/` and is not the browser grant root.
APP_DATA is an absolute backend data directory. No PORT/HOST requirement is
introduced by the SDK. Explicit configuration has identical validation.

UI proxy HTTP and WebSocket upgrades carry pioneer-app-execution-credential and
pioneer-app-user-id. Check the credential independently, constant-time, before
trusting identity (21 ASCII alphanumeric characters). Readiness checks only the
credential. Missing bootstrap never grants development authority. Duplicate
security headers are rejected by the Node adapter; custom adapters must reject
or return missing for duplicates, rather than merge them.
Identity is an admitted principal, not OS impersonation or PTY ownership.
Backends must enforce their own per-user resource access. PTYs run as Gateway's
OS account; do not expose a terminal handle to an unauthorized caller.

Gateway also provides pioneer-app-base-path, a relative reference from the
requested document to the grant root. An authenticated backend may render it as
an HTML base href (escaped). The browser SDK uses an explicit baseUrl or a base
href element, not token/path heuristics. Opaque iframe origin precludes ambient
cookies/storage authority. URLs retain proxy prefixes and must stay in that
view. Browser requests normally use credentials: 'omit'; they carry the scoped
view URL, never execution credentials.

## Theme

Parent posts {type:'pioneer.theme',palette:{appearance,background,foreground,
muted,border,accent,'accent-foreground'}}. appearance is light/dark; colors are
valid CSS colors of at most 128 characters. Check event.source === parent and
parent !== self; do not demand a non-opaque origin. There is no handshake or
ready event. Register early, before iframe load; late subscribers cannot request
a resend. current is null until a valid message and remains null outside Pioneer.
Subscription delivers future updates only. Disposing removes the listener.

## Host transport

Backend-only WebSocket at bootstrap host_api.endpoint. Authorization: Bearer
execution credential; no Origin. Capability host.pty is required. JSON-RPC 2.0,
request identifiers of exactly 21 Unicode characters (Gateway RequestId).
SDK generates 21 ASCII base64url characters with 126 random bits and excludes
collisions with pending requests. Create keys and stream IDs retain their own
independent limits; they are not RequestId. Errors use numeric -32001 and a stable host.* string
in error.message. Preserve host string codes independently of SDK codes.
No protocol version or capability subversion is currently supplied.
Execution revocation closes connections; handshake 401/403 is terminal, other
transport loss alone cannot conclusively distinguish revocation from an outage.
SDK retries are bounded, never an endless recovery loop.

PTY methods (wire spelling):

| Method | Parameters | Important result |
| --- | --- | --- |
| host.pty.create | key, dimensions, optional command:string[], cwd:string | session_id, input_sequence, retention_seconds:300 |
| host.pty.input | session_id, sequence, bytes:u8[] | accepted_sequence |
| host.pty.resize | session_id, dimensions | operation completion |
| host.pty.keepalive | session_id | operation completion |
| host.pty.close | session_id | operation completion |
| host.pty.subscribe | session_id, stream_id, after | subscribed, window:65536 |
| host.pty.ack | session_id, stream_id, after | acknowledged:boolean |
| host.pty.read | session_id, after | bounded output snapshot (legacy; not exposed) |

Dimensions: cols/rows 1..1000, optional pixel_width/pixel_height u16.
Create keys are execution-scoped, max 128 bytes, deduplicate identical parameter
objects, limited to 64 keys and 8 active PTYs. A retry must keep the exact key and
parameters. SDK generates a key and allows one transport-ambiguous create retry.
An unresolved create can remain leased for up to five minutes; no new create is
silently substituted. Canceling a sent operation cannot undo Gateway side effects.

Inputs: maximum 16384 bytes, next sequence only. Gateway remembers 64 accepted
frames / 128 KiB, and accepts retries only for identical remembered bytes and
sequence. Acceptance proves queue admission, not shell execution. SDK serializes
writes, queues at most 16, and never automatically retries input. After ambiguous
delivery, invalid ACK or host.input_outcome_unknown, later input is blocked.
host.input_backpressure proves nonacceptance and permits another write.

Output notification host.pty.output includes session_id, stream_id, after, bytes,
next, end, exit_status:null|u32, failed:boolean (plus input_sequence). Error
notifications may contain only identifiers and error:host.*. Byte cursors are
monotone; next=after+bytes.length. Retained output ring is 256 KiB. Frames are
at most 16 KiB; stream credit is 64 KiB and 64 data frames. Expired cursors are
host.output_cursor_expired, never a request to silently skip bytes or spawn a shell.
An exit status is a process state, not a transport failure. Consume through end
before considering output complete; failed is supervision failure.

SDK callback delivery does NOT consume output. frame.ack explicitly declares
cumulative consumption through frame.next, including all earlier frames. ACKs
serialize; use them after the actual downstream consumer finishes. Reconnect
replays from the last confirmed consumed cursor, potentially duplicating data;
applications should tolerate replay. ACK receipts from old connections are
fenced. Exactly-once downstream display is not guaranteed. Cursor arithmetic
uses safe integers in TypeScript; values beyond 2^53-1 are rejected, not rounded.
Confirmed ACK state is applied synchronously while dispatching its response,
before subsequent output messages, even in the same ws receive stack. Sending
an ACK alone does not advance the consumed cursor. Partial cumulative ACKs
remove only frame ends at or below the confirmed cursor from the outstanding
64-frame window. Zero-byte process-state notifications do not consume data credit.

## Ownership, cancellation and bounds

One SDK context owns only PTYs it creates. No attach or adoption API in v1.
One output subscription per handle. dispose unsubscribes locally, invalidates
receipts and removes callbacks, without killing the PTY. Gateway has no
unsubscribe method: local disposal stops ACK credit and ignores residual output.
The remote stream remains bounded by 64 KiB / 64 data frames, is replaced by
subscribe for the same session, and is removed by PTY close or connection close.
Other operations and subscriptions retain their connection and recovery budgets
(three attempts over each subscription lifetime). A failed subscription
is disposed and reports onError. Re-subscribe explicitly to start a new budget.
No timers loop on connection failure.

PTY close stops its timers/subscription and asks Gateway to destroy the process.
Context close waits for pending creates, closes owned handles, closes transport
and reports sdk.cleanup_incomplete if remote destruction was not confirmed,
including a create with an unknown result or any previously failed PTY close.
Unknown creates remain tracked across their one same-key retry until a valid
session response resolves identity. A refusal before send creates no uncertainty;
a refusal of a retry does not erase the earlier unknown outcome. Tracking of
unresolved creates and owned handles is bounded by the context's eight-slot limit.
Successful terminal close requires closed:true and releases ownership; a failed
close remains owned with its settled rejection, so repeated close calls are
idempotent and context close reports incomplete cleanup. No discovery API is used.
Local disposal is guaranteed even on that error; Gateway lease/revocation is the
fallback for remote cleanup. No signals, process.exit, HTTP server, or port choice.
An idle PTY receives one keepalive every ten seconds, with at most one in flight.
Local capacity, transport errors, host.capacity and host.operation_failed allow
up to three consecutive failed heartbeats; a successful alive:true resets that
budget. Recovery never creates a shell. After three failures or 240 seconds
without confirmed keepalive, sdk.lease_unconfirmed stops heartbeats and local
subscription delivery. This is uncertainty, not proof of expiry. Other Host
errors (including session_expired, session_unavailable and revoked) stop them
immediately with the original code. Operations remain usable during transient
failures. Close/revocation aborts an in-flight heartbeat and stops the interval;
context close still attempts cleanup. Gateway's five-minute lease remains the
authority, not the SDK's shorter recovery budget.

RPC deadline 10 seconds, connection handshake deadline 10 seconds, max 64 calls,
max 64 queued ACK calls per subscription,
128 KiB socket send-buffer threshold, 128 KiB receive payload. Cancellation before
send is sdk.cancelled; cancellation/timeout/disconnect after send is
sdk.delivery_unknown. It does not retract an operation. Queued input cancellation
is observed before it can send. Stream AbortSignal disposes the subscription.

## Compatibility limits and sources

Inspected production sources in ../pioneer: crates/gateway/src/host_api/{mod,
pty,stream}.rs, transport/http/apps.rs, message/apps/runtime.rs; desktop-apps/src/lib.rs;
client/src/apps.rs. Terminal sources: server.ts, lib/gateway-host.ts,
lib/host-theme.ts, app/layout.tsx. Gateway source is authoritative.
Terminal's automatic callback ACK and localized HostError messages are application
choices and deliberately not shared. Its watch loop can continue retrying; SDK
uses a finite budget. Gateway has legacy read/changed notifications but no
capability discriminator for streaming. SDK requires the inspected streaming
methods; an older host advertising only host.pty can reject them with
host.method_not_allowed. Future protocol capability granularity is a proposal,
not a negotiation implemented here.

Local dev URL registration is separate and does not provision backend authority.
No dependency on unfinished dev internals; configuration loading is separate from
transport. Python/Rust SDKs, framework bridges, Terminal integration and dev
end-to-end integration remain separate work.
