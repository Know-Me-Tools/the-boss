# change-010-runtime-control-plane

Status: completed
Phase: `multi-runtime-agent-parity-assessment`
Depends on: NONE
Recommended agent: Codex
Complexity: M

## Goal

Make runtime profile/settings and health checks real product functionality instead of internal-only repository code and local UI state.

## Scope

- Runtime profile/settings repository usage.
- Runtime effective config resolver.
- Main IPC handlers and preload typing.
- Runtime settings UI health/test behavior.
- Unit tests for merging and health checks.

## Tasks

- [x] Add a runtime control service for profile/settings CRUD, effective config resolution, and runtime health checks.
- [x] Expose runtime control APIs through `IpcChannel`, main IPC handlers, preload, and preload types.
- [x] Merge global runtime settings, selected runtime profile, and agent/session runtime overrides deterministically.
- [x] Make `RuntimeSettings` load/select profiles instead of using only free text.
- [x] Make `RuntimeSettings` call backend health/test for Claude, Codex, OpenCode, UAR remote, and UAR embedded.
- [x] Return concrete UAR embedded states: missing binary, starting, ready, not ready, crashed, stopped.
- [x] Add focused tests that fail without real IPC/service health behavior.

## Verification

- [x] Runtime control service tests pass.
- [x] Runtime settings UI test proves "Test connection" calls backend API.
- [x] UAR embedded health verifies the sidecar binary and readiness path.

## Constraints

- Do not add Redux slices.
- Do not modify IndexedDB schema.
- Do not use `v2`.
