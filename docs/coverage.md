# Current Apps contract coverage

Audit baseline: ec409bb; source check, not executable validation. Read-only
sources below are relative to the sibling repositories. Findings are tracked
through configuration → request → Gateway → response → consumer → teardown.

| Existing platform contract / source | Terminal use | SDK API | Baseline gap → resolution / prepared proof |
| --- | --- | --- | --- |
| desktop-apps/src/lib.rs dev_theme_script, theme_script | lib/host-theme.ts | connectApp, theme.current/subscribe | Direct page rejected; late subscriber missed initial palette → self+origin or parent checking, immediate current delivery; client regressions |
| transport/http/apps.rs grant path, pioneer-app-base-path | app/layout.tsx base href, browser fetch/WS | url, webSocketUrl | Retain explicit/base root, prefix and containment; existing URL cases + base href/dev tests |
| message/apps/runtime.rs bootstrap and APP_DATA | server.ts | createAppServerContext, execution.id, appData | Existing validated loading retained; auth/bootstrap regression owner |
| transport/http/apps.rs HTTP/upgrade injected headers; runtime readiness credential | server.ts | authenticateRequest, authenticateServiceRequest, nodeRequestHeaders | Existing constant-time proxy auth before principal, duplicate rejection retained; auth tests |
| host_api/mod.rs backend Bearer, host.pty capability, RequestId | lib/gateway-host.ts | host.capabilities, host.pty.create | Existing backend-only transport retained; peer enforces wire ID and headers |
| host_api/pty.rs create command/cwd/dimensions | GatewayHost.spawn | Pty.write/resize/close | Preserve input ambiguity, pixel sizes, ownership; peer bounds, input/cleanup tests |
| host_api/stream.rs subscribe/output/ack | GatewayHost watch/drain/pause | Pty.subscribe, OutputFrame.ack, subscription.cursor/dispose | Check connection epoch after subscribe, finite initial recovery; replay/ACK regressions, Terminal consumption recipe |
| host_api/pty.rs read + keepalive; mod.rs changed | Legacy read/changed not used by current Terminal; keepalive is used | Pty.read, keepalive, onChanged | Missing public snapshot and explicit maintenance APIs; add typed legacy hints/snapshots and regressions |
| Execution revocation/lease, connection limits | GatewayHost close/error paths | PioneerError, context.close | Retain bounded calls/recovery, unknown create/close accounting; existing lifecycle tests |
| dev URL admission, desktop-apps/src/lib.rs app_view_attributes | dev-server.ts, local-pty.ts | Client-only connectApp | UI registration supplies no Host authority; local backend stays application-owned, no SDK auth bypass |
| Terminal package.json build:server; scripts/pioneer/trace-runtime.mjs | external require in build/server.cjs, physical-root trace | package subpath import/require exports | ESM-only and sibling symlink unsuitable → dual output, installed tarball/locked dependency; package acceptance test + integration instructions |

Gateway's entire app Host dispatch is six PTY owner methods (create/input/read/
resize/keepalive/close) and two stream methods (subscribe/ack). Notifications are
output and legacy changed. No other app service is admitted. read is a bounded
snapshot, not an ACK; changed is only an invalidation hint before the connection
has ever entered streaming mode. Neither creates new credit nor replaces the
streaming consumer contract.

All executable proofs in this table are prepared for external acceptance, not
run here. Source-complete coverage does not establish package compilation or
runtime correctness. No modifications in Pioneer or Terminal are required for
these SDK changes; subsequent Terminal integration is separate work.
