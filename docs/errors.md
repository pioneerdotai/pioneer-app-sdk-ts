# Stable error codes

PioneerError.source is sdk or host. Messages are diagnostic, not localized UI.
Host errors retain the Gateway host.* message code and numeric rpcCode. No raw
remote error text/data is attached. Unknown host names matching host.[a-z_]+
are retained (maximum suffix length 64); malformed names become
host.operation_failed. Applications must tolerate future codes.

| SDK code | Meaning |
| --- | --- |
| sdk.browser_required | Client called without browser window |
| sdk.base_url_required | No explicit view root or base element |
| sdk.invalid_url | Unsupported URL or path outside the view scope |
| sdk.invalid_app_data | APP_DATA absent or not absolute |
| sdk.bootstrap_missing | No absolute bootstrap file path |
| sdk.invalid_bootstrap | Invalid/unreadable/oversized configuration |
| sdk.unauthorized | Missing/invalid proxy credential |
| sdk.user_missing | No valid trusted principal after authentication |
| sdk.capability_unavailable | Host API absent or host.pty not advertised |
| sdk.closed | Handle/context/transport has closed |
| sdk.capacity | Bounded queue/window/request capacity exceeded |
| sdk.limit | Input/request/sequence size limit exceeded |
| sdk.invalid_params | Invalid command/cwd |
| sdk.invalid_dimensions | Invalid PTY size |
| sdk.invalid_cursor | Invalid requested output cursor |
| sdk.invalid_response | Invalid create/input acknowledgement |
| sdk.invalid_output | Invalid/noncontiguous output frame |
| sdk.cancelled | Operation cancelled before send |
| sdk.disconnected | Connection unavailable before send |
| sdk.delivery_unknown | Sent operation may have taken effect |
| sdk.input_blocked | Earlier uncertain input prevents subsequent input |
| sdk.stale_receipt | ACK belongs to a replaced/disposed stream |
| sdk.callback_failed | Output callback threw an untyped exception |
| sdk.cleanup_incomplete | Local teardown done, remote PTY close unconfirmed |

Significant Gateway codes: host.revoked, host.method_not_allowed,
host.invalid_params, host.invalid_dimensions, host.capacity,
host.idempotency_conflict, host.session_expired, host.session_unavailable,
host.input_limit, host.input_sequence_conflict, host.input_outcome_unknown,
host.input_backpressure, host.output_cursor_expired, host.invalid_cursor,
host.pty_unsupported_platform, host.utf8_locale_unavailable, host.operation_failed.
See contract.md for the operational meaning of ambiguity, expiry and revocation.
