# change-005-artifact-designer-3pane

Status: DONE
Priority: P1
Assigned backend: claude-code (subagent-driven TDD)
Recommended agent: tdd-guide → typescript-reviewer + a11y-architect
Depends on: change-002, change-004
Phase: artifact-editor-iterative-design-protocol

## Goal

A 3-pane iterative artifact designer (chat │ code │ preview): the chat pane submits
NL requests to the change-004 orchestrator; the code pane shows the current source; the
preview pane renders the built artifact. Existing `ArtifactPopup` viewer/manual-editor
behavior must remain unchanged.

## Implementation decision

Built as a NEW sibling component `ArtifactDesigner.tsx` rather than mode-gating the
711-line `ArtifactPopup.tsx`. Rationale: lower risk — `ArtifactPopup` (with its complex
service-bridge effect) is left completely untouched, which satisfies "existing behavior
unchanged" more strongly than threading `mode` branches through it. The designer reuses
the same primitives directly (`@renderer/components/CodeEditor`, a sandboxed `<iframe>`).
No `artifactPanels.tsx` extraction was needed.

## Tasks

- [x] Add `ArtifactDesigner.tsx` (3-pane: chat │ code │ preview).
- [x] Hold `EditorState` (init via `initEditorState`); Send → injected `runTurn`
      (defaults lazily to `runDesignTurnDefault`) → apply returned state.
- [x] Bind state to panes: source → code pane; phase==='preview' → preview iframe;
      repair diagnostics / error → chat transcript (+ assertive alert region).
- [x] i18n all new strings (`artifacts.designer.*`); `pnpm i18n:check` clean.
- [x] Keyboard (Ctrl/Cmd+Enter to send) + focus order chat→code→preview; ARIA labels.
- [x] Component tests (12); existing `ArtifactPopup.test.tsx` kept green (2/2).

## Acceptance Criteria

- [x] Existing `ArtifactPopup` behavior unchanged (file untouched; 2/2 regression green).
- [x] Designer renders 3 panes and reacts to reducer state.
- [x] a11y pass; no hardcoded UI strings (i18n:check clean).

## Outcome

- Files: NEW `src/renderer/src/components/CodeBlockView/ArtifactDesigner.tsx`,
  NEW `__tests__/ArtifactDesigner.test.tsx`, + new `artifacts.designer.*` i18n keys
  (en base, synced to all locales). `ArtifactPopup.tsx` NOT modified.
- Tests: ArtifactDesigner 12/12; ArtifactPopup 2/2 (regression). Biome clean; tsgo (web)
  0 errors from ArtifactDesigner files; i18n:check passes; no `console.*`.
- Two-stage review (tdd-guide → typescript-reviewer + a11y-architect). Fixes applied:
  - HIGH (security): removed `allow-same-origin` from the preview iframe `sandbox`
    (designer has no postMessage bridge; `allow-same-origin`+`allow-scripts` was a
    sandbox-escape vector for model-generated code) → `sandbox="allow-scripts allow-forms"`.
  - HIGH (a11y): added a visually-hidden `role="alert"`/`aria-live="assertive"` region so
    errors/repair diagnostics are announced assertively (transcript stays polite `role="log"`).
  - MEDIUM: closed a double-submit race (set `inFlight` before the lazy import await);
    memoized `previewDoc`; added `aria-busy` to the transcript; per-instance turn counter.
  - Fixed 7 tsgo errors in the test (Vitest `vi.fn` generic form).
- Boundaries (deferred to change-006): code pane is read-only in v1; the Save button calls
  `onSaveToLibrary` but the `artifact_saved` → reducer wiring lands in change-006.
- QA gate (artifact-refiner): change is 2 new files + i18n; core logic two-stage-reviewed
  (TS + a11y). Reviewed in lieu of refiner.

## Verification

- `pnpm test:renderer …/ArtifactDesigner.test.tsx` — 12/12 (Node 24.16.0)
- `pnpm test:renderer …/ArtifactPopup.test.tsx` — 2/2
- `pnpm exec biome check` — clean · tsgo (web) — 0 from these files · `pnpm i18n:check` — pass
