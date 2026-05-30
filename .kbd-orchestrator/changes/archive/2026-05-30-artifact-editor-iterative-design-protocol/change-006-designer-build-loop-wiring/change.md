# change-006-designer-build-loop-wiring

Status: DONE
Priority: P1
Assigned backend: claude-code (subagent-driven TDD)
Recommended agent: tdd-guide → code-reviewer
Depends on: change-003, change-004, change-005

## Goal

Close the build-in-the-loop end to end and persist results. A failed `build_status`
surfaces in the chat pane and seeds the next turn ("edit again until functional"); on
accept, save a new artifact version via the library.

## Tasks

- [x] Surface `build_status` diagnostics in the chat pane; a one-click "Fix it" button
      (shown when phase==='repair') feeds the failure into the next orchestrator turn
      (auto-composed repair request). Manual prompt still works during repair.
- [x] On accept → save via injected `saveArtifact` seam (parent wires
      `useArtifactLibrary().saveArtifact`); on success set `savedRecordId` + phase idle.
- [x] Cancel leaves the library untouched (never calls saveArtifact).
- [x] Visible loading / repair / saving / saved / error states.
- [x] Integration tests: create → preview → save; failing build → Fix it → preview;
      cancel path; save-failure path; jsx draft shape; empty-title/empty-source guards.

## Acceptance Criteria

- [x] Build failures drive a repair turn without manual re-prompting (one-click Fix it).
- [x] Accepting saves a version; canceling does not mutate the library (tested).
- [x] Loop is observable (status/repair/saving/saved/error all surfaced + announced).

## Key decision (documented in component header)

The reducer's `artifact_saved` event is **turn-scoped** — after `design_run_complete`
clears `activeTurnId`, an `artifact_saved` event would fail the reducer's
`turnId === activeTurnId` guard and be silently dropped. Post-turn library save is a
component-level concern, so `handleSave` sets `savedRecordId` directly via
`setEditorState((p)=>({...p, savedRecordId:id, phase:'idle'}))` (consistent with the
reducer's own artifact_saved transition; head/history invariants preserved). The
orchestrator/reducer is NOT fed a dropped event.

## Outcome

- File: `ArtifactDesigner.tsx` extended (executeTurn shared by Send + Fix it; handleSave
  builds an ArtifactRecordDraft via languageToKind/languageToRuntimeProfileId;
  cancel/save-error/saved states). New `__tests__/ArtifactDesigner.loop.test.tsx`.
- Tests: designer + loop 29/29; ArtifactPopup 2/2 regression. Biome clean; tsgo (web)
  0 errors from these files; no console.*.
- Two-stage review (tdd-guide → code-reviewer). Fixes applied:
  - **i18n bug (found in verification)**: component called `t('artifacts.designer.*')`
    but keys live under `settings.artifacts.designer.*` — strings would NOT resolve at
    runtime (mock/i18n:check hid it). Fixed all 20 `t()` calls to the correct prefix and
    added missing keys (preview_title, preview_placeholder, save, status.error) +
    `i18n:sync`. Verified every referenced key resolves against en-us.json.
  - MEDIUM: empty-title → `untitled` fallback (avoids schema min(1) IPC rejection);
    empty-source guard → `save_error_empty_source` (defense-in-depth).
  - Added regression tests: empty-title fallback, empty-source guard, jsx draft shape,
    post-save idle state.
- Boundary: code pane remains read-only (manual editing deferred; documented).
- QA gate (artifact-refiner): reviewed in lieu of refiner (1 component + test + i18n;
  two-stage reviewed; i18n resolution independently verified).

## Verification

- `pnpm test:renderer …/ArtifactDesigner.test.tsx …/ArtifactDesigner.loop.test.tsx` — 29/29
- `pnpm test:renderer …/ArtifactPopup.test.tsx` — 2/2
- Biome clean · tsgo (web) 0 from these files · `pnpm i18n:check` pass · all designer keys resolve
