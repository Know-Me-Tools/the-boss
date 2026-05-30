# KBD Waypoint

**Project:** The Boss / Cherry Studio fork
**Active phase:** artifact-editor-iterative-design-protocol
**Status:** execution_in_progress (5 / 7 changes DONE)
**Branch:** feat/artifact-iterative-designer (off main; never v2)
**Last updated:** 2026-05-30

## Exact next step

```
sed -n '1,60p' .kbd-orchestrator/changes/change-006-designer-build-loop-wiring/change.md
```

Then implement **change-006-designer-build-loop-wiring** (TDD + code-reviewer).
Run `fnm use 24` (or nvm; repo requires Node >=24.11.1) before `pnpm test`/`lint`.

## Progress — M1 spine COMPLETE; M2 in progress (5/7)

- ✅ **001 protocol types** — events, payload schema, versionHash. 27 tests.
- ✅ **002 editor reducer** — pure state machine; stale-turn guard; repair/error. 94 tests.
- ✅ **003 build-feedback seam** — React compile + HTML validate → build_status. 22 tests.
- ✅ **004 design orchestrator** — runDesignTurn loop; tolerant extractJson. 46 tests.
- ✅ **005 3-pane designer** — NEW `ArtifactDesigner.tsx` (chat│code│preview); Send →
  orchestrator → reducer state → panes; sandboxed preview (no allow-same-origin);
  assertive a11y alert region. 12 tests; ArtifactPopup 2/2 regression intact.
  `ArtifactPopup.tsx` untouched (sibling-component approach).
- ▶ **006 build-loop wiring** (NEXT): close build-in-the-loop end to end — failed
  build_status seeds the next turn ("edit until functional"); on accept, save a new
  ArtifactVersion via useArtifactLibrary (wires artifact_saved → reducer, deferred from
  005). Code pane could become editable here. Cancel leaves library untouched.
- 007 (M3): "Edit with AI" entry from artifact cards + docs.

## Backend / discipline

Native KBD. Execution backend: native-tool (claude-code, subagent-driven TDD).
Per-change gate: `pnpm lint && pnpm test` under Node 24 (default shell node is v20 —
`fnm use 24` first). Commit `--signoff`, `--no-verify` (pre-commit hook uses old node;
gates verified manually under 24). Constraints: 1.9.x, never v2; loggerService not
console; i18n all strings; no new Redux/Dexie schema.
