# KBD Waypoint

**Project:** The Boss / Cherry Studio fork
**Active phase:** artifact-editor-iterative-design-protocol
**Status:** execution_in_progress (4 / 7 changes DONE — M1 spine COMPLETE)
**Branch:** feat/artifact-iterative-designer (off main; never v2)
**Last updated:** 2026-05-30

## Exact next step

```
sed -n '1,60p' .kbd-orchestrator/changes/change-005-artifact-designer-3pane/change.md
```

Then implement **change-005-artifact-designer-3pane** (TDD + typescript-reviewer + a11y-architect).
Run `fnm use 24` (or nvm; repo requires Node >=24.11.1) before `pnpm test`/`lint`.

## Progress — M1 SPINE COMPLETE ✅ (189 artifacts tests green)

- ✅ **change-001 — protocol types** (DONE): `ArtifactDesignEvent` union, payload schema,
  `versionHash`. 27 tests.
- ✅ **change-002 — editor reducer** (DONE): pure state machine; stale-turn guard; repair
  loop; error recovery. 94 tests. 2 HIGH + 2 MEDIUM review fixes.
- ✅ **change-003 — build-feedback seam** (DONE): React via injected `compileReact`; HTML
  conservative validation; emits `build_status`. 22 tests. HIGH false-positive fixed.
- ✅ **change-004 — design orchestrator** (DONE): `runDesignTurn(input, deps)` — emits
  start→artifact_full→build_status→complete (or error); injected model+build; tolerant
  `extractJson`. Pure core + isolated `designOrchestrator.default.ts` wiring. 46 tests.
  HIGH (extractJson) + MEDIUM (empty-response) review fixes.
- ▶ **change-005 — 3-pane designer** (NEXT, M2): extend `ArtifactPopup` → chat│code│preview
  behind `mode='designer'`; chat pane → `runDesignTurnDefault`; bind editorReducer state to
  panes; i18n + a11y; keep existing ArtifactPopup tests green. First UI change.
- change-006 build-loop wiring + save. M3: change-007 entry + docs.
- M2: 005 3-pane designer, 006 build-loop wiring. M3: 007 entry + docs.

## Backend

Native KBD (`openspec/` empty scaffolding). Execution backend: native-tool
(claude-code, subagent-driven TDD). Per-change gate: `pnpm lint && pnpm test`.
QA gate (artifact-refiner) when ≥3 files; skipped for change-001 (2 files).

## Recovery note

This branch was created off `main` after an external reset wiped the untracked KBD
artifacts. Recovered assessment.md (from commit 73fb84247) and the 7 change files
(from planning commit 2de102468, still in the object store); design/plan/execution/
constraints re-authored. change-001 code survived intact and is re-verified.
