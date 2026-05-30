# KBD Waypoint

**Project:** The Boss / Cherry Studio fork
**Active phase:** artifact-editor-iterative-design-protocol
**Status:** execution_in_progress (3 / 7 changes DONE)
**Branch:** feat/artifact-iterative-designer (off main; never v2)
**Last updated:** 2026-05-30

## Exact next step

```
sed -n '1,60p' .kbd-orchestrator/changes/change-004-artifact-design-orchestrator/change.md
```

Then implement **change-004-artifact-design-orchestrator** (TDD + two-stage review).
Run `fnm use 24` (or nvm; repo requires Node >=24.11.1) before `pnpm test`/`lint`.

## Progress

- ✅ **change-001 — protocol types** (DONE): `ArtifactDesignEvent` union (readonly
  `build_status`), `ArtifactDesignTurnPayloadSchema`, `versionHash` (FNV-1a). 27/27 tests.
- ✅ **change-002 — editor reducer** (DONE): pure state machine
  (`idle→streaming→building→preview|repair→saving→idle`+`error`); stale-turn guard;
  repair loop; error recovery. 94/94 tests. Two-stage review: 2 HIGH + 2 MEDIUM fixed.
- ✅ **change-003 — build-feedback seam** (DONE): `runBuildFeedback(input, deps)` —
  React via injected `compileReact` ({ ok, script, diagnostics }); HTML conservative
  pure validation (no false-positive on JS operators); emits `build_status`. 22/22 tests.
  Two-stage review caught + fixed a HIGH HTML false-positive.
- ▶ **change-004 — design orchestrator** (NEXT, last of M1 spine): renderer loop —
  NL request + current source → chat model via structured output/tool → emit
  `ArtifactDesignEvent`s driving the reducer; one turn = prompt → artifact_full →
  reducer applies → buildFeedback → build_status. Mock the model in tests. First change
  to touch existing aiCore plumbing — read `packages/aiCore` + `src/renderer/src/aiCore`.
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
