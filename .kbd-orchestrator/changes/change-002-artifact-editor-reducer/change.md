# change-002-artifact-editor-reducer

Status: TODO
Priority: P0
Assigned backend: claude-code (subagent-driven TDD)
Recommended agent: tdd-guide → typescript-reviewer
Depends on: change-001-artifact-design-protocol-types
Phase: artifact-editor-iterative-design-protocol

## Goal

Implement the pure editor state machine that consumes `ArtifactDesignEvent`s and drives
the multi-turn create→edit→preview→save loop. No React, no IPC — a pure reducer so the
hard correctness work is unit-tested in isolation.

States: `idle → prompting → streaming → applying → building → preview → repair → saving → idle`,
plus a recoverable `error` state.

## Tasks

- [ ] Add `src/renderer/src/artifacts/editorReducer.ts` (state type + reducer).
- [ ] Record `versionHash` on every source mutation; expose current head hash.
- [ ] Stale-turn guard: reject a turn whose `baseVersionHash` ≠ current head.
- [ ] Repair loop: `build_status{ok:false}` → `repair` → next `prompting`.
- [ ] Error recovery: `design_run_error` → `error` → back to `prompting`.
- [ ] Exhaustive unit tests for every transition + guards.

## Acceptance Criteria

- [ ] Reducer is pure (no side effects, no React/IPC imports).
- [ ] Tests cover stale-turn rejection, repair re-entry, error recovery, save path.
- [ ] Invalid transitions are no-ops or explicit errors (never silent corruption).

## Verification

- `pnpm test:renderer src/renderer/src/artifacts/__tests__/editorReducer.test.ts`
- `pnpm lint`
