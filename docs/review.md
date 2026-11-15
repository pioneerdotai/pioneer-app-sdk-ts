# Manual review record

No executable verification was permitted or performed. These findings are from
source reading, not compiler/test results.

1. Contract review: retained actual JSON-RPC names, optional command/cwd,
   dimensions and ACK cursor semantics; rejected a guessed grant-root heuristic,
   browser credentials, a new handshake, dev authorization and Terminal's UI
   protocol. No production README claim is used over Gateway source. Terminal's
   code automatically ACKs callback delivery and retries watches without a total
   bound; these are app policies, not required SDK guarantees.
2. Implementation review: checked client dependency graph (only browser code and
   shared error module), closure/private credential ownership, duplicate Node
   headers, independent readiness authentication, serial input, stale stream
   receipts, resource ownership. Fixed missing bound on callers awaiting a
   connection, and retained closing PTYs in context ownership until close settles
   so concurrent context shutdown can await their cleanup.
   Final corrections fence late send-error callbacks by socket identity and
   bound queued ACK calls at 64. These were source-inspection findings, not
   executed regressions. The test-only pass preserved staged implementation
   bytes (reviewed with git diff) and ended before these implementation fixes.
   Also preserved connection-wait reservations until handshake settlement after
   cancellation, and avoided shared-socket resets when closing PTYs (the close
   method itself removes the wire stream), so concurrent owned cleanup does not
   terminate its own replacement connection.
3. Final diff review: checked package subpath exports against emitted paths,
   .js relative specifiers for NodeNext ESM, declarations configuration, runtime
   ws dependency and development-only type/runner dependencies, examples and
   documented bounds. No package-root export or lifecycle hook. No lockfile was
   generated because installation is forbidden. Dependency resolution, type
   declarations and emitted package imports require external verification.

Prepared tests exercise public client/server boundaries with a local scripted
Host WebSocket peer; they are not assertions against private maps. Common fixtures
record literal language-independent protocol examples. Source review cannot
establish compilation or timing correctness. External review must examine stream
replacement, operation ambiguity and remote lease fallback in particular.
