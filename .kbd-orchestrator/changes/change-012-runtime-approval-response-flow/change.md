# change-012-runtime-approval-response-flow

Status: completed
Phase: `multi-runtime-agent-parity-assessment`
Depends on: `change-011-runtime-session-bindings`
Recommended agent: Codex
Complexity: M

## Goal

Make runtime approval UI actionable instead of display-only.

## Scope

- Runtime approval response service.
- Runtime adapters where approval responses are supported.
- IPC/preload APIs.
- Runtime block button handlers.
- Tests for supported and unsupported response behavior.

## Tasks

- [x] Add a typed runtime approval response API.
- [x] Wire `RuntimeBlock` approval buttons to the response API with pending/success/error state.
- [x] Implement OpenCode approval response when the SDK exposes a callable permission response surface.
- [x] Return explicit unsupported errors for Codex/UAR approval responses until their protocol support is verified.
- [x] Add tests so approval buttons cannot regress to inert UI.

## Verification

- [x] Runtime approval service tests pass.
- [x] Runtime block tests prove approval buttons call the backend.

## Constraints

- Do not fake approval success for unsupported runtimes.
- Do not use `v2`.
