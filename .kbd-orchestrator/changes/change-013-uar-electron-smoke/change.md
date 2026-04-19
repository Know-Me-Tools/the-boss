# change-013-uar-electron-smoke

Status: completed
Phase: `multi-runtime-agent-parity-assessment`
Depends on: `change-010-runtime-control-plane`, `change-011-runtime-session-bindings`, `change-012-runtime-approval-response-flow`
Recommended agent: Codex
Complexity: M

## Goal

Prove embedded UAR runs through the Electron app's main-process sidecar path.

## Scope

- Smoke test or harness.
- UAR sidecar start/health/chat/stop path.
- Documentation update only if command usage changes.

## Tasks

- [x] Add a smoke test that starts UAR via `UniversalAgentRuntimeService`.
- [x] Verify `/healthz` and `/readyz` through the same endpoint returned to the app.
- [x] Send a chat request through `UarRuntimeAdapter` or the normal runtime router path.
- [x] Assert runtime telemetry and assistant text are emitted.
- [x] Stop the sidecar and assert cleanup.

## Verification

- [x] UAR smoke test passes locally.
- [x] `pnpm uar:build:sidecar` passes.
- [x] Final `pnpm format`, `pnpm lint`, and `pnpm test` pass.

## Constraints

- Do not introduce external services for embedded UAR smoke.
- Do not use `v2`.
