# KBD Waypoint

**Project:** The Boss / Cherry Studio fork
**Active phase:** artifact-editor-iterative-design-protocol
**Status:** planning_complete
**Last updated:** 2026-05-30

## Exact next step

```
sed -n '1,120p' .kbd-orchestrator/phases/artifact-editor-iterative-design-protocol/plan.md
```

Then begin execution: `/kbd-execute artifact-editor-iterative-design-protocol`
starting with `change-001-artifact-design-protocol-types`.

## Why

Plan phase complete. All 3 open design questions resolved (single-file artifacts;
extend `ArtifactPopup` into a 3-pane designer; renderer-local typed event channel that
mirrors `CanonicalAgentEvent` naming). Design doc written ([design.md]) and an ordered
7-change list emitted as native KBD change files (`change-001`…`change-007`).

Backend: native KBD (OpenSpec scaffolding present but empty/inactive; openSpecDetected=false).
No evolver cycle → no bridge.

Build order is protocol-first / bottom-up:
M1 spine (001 types → 002 reducer → 003 build seam → 004 orchestrator, all unit-tested,
zero UI) → M2 designer (005 3-pane + 006 closed build loop + save) → M3 entry+docs (007).

Constraints: 1.9.x base, never v2; feature branch off main; loggerService not console;
i18n all strings; no new Redux/Dexie schema; TDD + two-stage review per change.
