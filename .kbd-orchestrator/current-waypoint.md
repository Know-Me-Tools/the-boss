# KBD Waypoint

**Project:** The Boss / Cherry Studio fork
**Active phase:** artifact-editor-iterative-design-protocol
**Status:** execution_in_progress (2 / 7 changes DONE)
**Branch:** feat/artifact-iterative-designer (off main; never v2)
**Last updated:** 2026-05-30

## Exact next step

```
sed -n '1,60p' .kbd-orchestrator/changes/change-003-artifact-build-feedback-seam/change.md
```

Then implement **change-003-artifact-build-feedback-seam** (TDD + two-stage review).
Run `fnm use 24` (or nvm; repo requires Node >=24.11.1) before `pnpm test`/`lint`.

## Progress

- ✅ **change-001 — protocol types** (DONE): `ArtifactDesignEvent` union (readonly
  `build_status`), `ArtifactDesignTurnPayloadSchema`, `versionHash` (FNV-1a). 27/27
  tests, Biome clean, tsgo clean. Two-stage review applied.
- ✅ **change-002 — editor reducer** (DONE): pure state machine
  (`idle→streaming→building→preview|repair→saving→idle`+`error`); stale-turn guard;
  repair loop; error recovery; resets stale build/save state on new turn. 94/94 tests,
  Biome clean, tsgo clean. Two-stage review: 2 HIGH + 2 MEDIUM fixed, locked by tests.
- ▶ **change-003 — build-feedback seam** (NEXT): React → `compileReactArtifact`
  mapping `{diagnostics,errors}`; HTML → light validation; emits `build_status`; IPC
  injected/mockable; no UI.
- change-004 orchestrator (rest of M1 spine).
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
