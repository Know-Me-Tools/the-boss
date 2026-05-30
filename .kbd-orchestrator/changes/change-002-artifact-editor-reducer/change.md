# change-002-artifact-editor-reducer

Status: DONE
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

- [x] Add `src/renderer/src/artifacts/editorReducer.ts` (state type + reducer).
- [x] Record `versionHash` on every source mutation; expose current head hash (`headVersionHash`).
- [x] Stale-turn guard: reject a turn whose `baseVersionHash` ≠ current head.
- [x] Repair loop: `build_status{ok:false}` → `repair` → next turn.
- [x] Error recovery: `design_run_error` → `error` → recover via new `design_run_start`.
- [x] Exhaustive unit tests for every transition + guards (94 tests).

## Acceptance Criteria

- [x] Reducer is pure (no side effects, no React/IPC imports — only `./designProtocol` + `@shared` types).
- [x] Tests cover stale-turn rejection, repair re-entry, error recovery, save path.
- [x] Invalid transitions are no-ops or explicit errors (never silent corruption).

## Verification

- `pnpm test:renderer …/editorReducer.test.ts` — 94/94 pass (Node 24.16.0).
- Biome clean; no `console.*`; no forbidden imports; tsgo (web) no errors from this file.

## Outcome

- Files: `src/renderer/src/artifacts/editorReducer.ts` (+ exhaustiveness guard),
  `src/renderer/src/artifacts/__tests__/editorReducer.test.ts`.
- State machine: `idle→streaming→building→preview|repair→saving→idle` + recoverable `error`.
- Two-stage review (tdd-guide → typescript-reviewer). Reviewer found 1 CRITICAL
  (TS1117 duplicate keys — already resolved by the clean two-step `initEditorState`),
  2 HIGH + 2 MEDIUM, ALL fixed and locked by updated/added regression tests:
  - new `design_run_start` resets stale `lastBuild` + `savedRecordId`;
  - `artifact_full` resets `lastBuild` (new source invalidates prior build);
  - `design_run_error` ignores stale-turn errors while a newer turn is active;
  - `design_run_complete` mid-stream (non-terminal phase) → `error`, not stranded;
  - `artifact_saved` clears `activeTurnId` (next turn not wrongly rejected);
  - added `default` exhaustiveness guard on the event switch.
- QA gate (artifact-refiner): skipped — 2 files modified, below the <3-file threshold.
