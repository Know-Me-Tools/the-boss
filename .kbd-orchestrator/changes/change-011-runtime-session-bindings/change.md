# change-011-runtime-session-bindings

Status: completed
Phase: `multi-runtime-agent-parity-assessment`
Depends on: `change-010-runtime-control-plane`
Recommended agent: Codex
Complexity: M

## Goal

Persist runtime session ids per runtime kind so runtime switching cannot reuse an incompatible backend thread id.

## Scope

- Runtime session binding repository.
- Session message stream resume path.
- Runtime adapters.
- Tests for runtime switching and resume.

## Tasks

- [x] Add repository methods for get/upsert runtime session bindings.
- [x] Read the last runtime session id by `(session_id, runtime_kind)` before invoking an adapter.
- [x] Upsert the returned runtime session id after successful runtime completion.
- [x] Preserve legacy `agent_session_id` persistence for display/backward compatibility without using it as the cross-runtime source of truth.
- [x] Add tests proving Claude/Codex/OpenCode/UAR session ids do not cross-contaminate.

## Verification

- [x] Session binding repository tests pass.
- [x] Session message service tests pass for runtime-specific resume.

## Constraints

- Do not alter existing message payload shape unless required for compatibility.
- Do not use `v2`.
