# KBD Waypoint

**Project:** The Boss / Cherry Studio fork
**Active phase:** artifact-editor-iterative-design-protocol
**Status:** execution_in_progress (6 / 7 changes DONE — M1 + M2 COMPLETE)
**Branch:** feat/artifact-iterative-designer (off main; never v2)
**Last updated:** 2026-05-30

## Exact next step

```
sed -n '1,60p' .kbd-orchestrator/changes/change-007-create-path-entry-and-docs/change.md
```

Then implement **change-007-create-path-entry-and-docs** (final change; code-reviewer → doc-updater).
Run `fnm use 24` (or nvm; repo requires Node >=24.11.1) before `pnpm test`/`lint`.

## Progress — M1 + M2 COMPLETE (6/7)

- ✅ 001 protocol types (27) · 002 reducer (94) · 003 build seam (22) · 004 orchestrator (46) — M1 spine
- ✅ 005 3-pane designer — ArtifactDesigner.tsx (chat│code│preview); sandboxed preview;
  assertive a11y. 12 tests.
- ✅ 006 build-loop wiring + save — one-click "Fix it" repair turn; accept → saveArtifact
  draft → savedRecordId (direct, since reducer artifact_saved is turn-scoped); cancel
  never saves; empty-title/source guards. Fixed an i18n prefix bug (keys now resolve at
  runtime under settings.artifacts.designer.*). designer+loop 29 tests.
- ▶ **007 entry + docs** (NEXT, M3): add an "Edit with AI" action to the artifact cards
  (ReactArtifactsCard / HtmlArtifactsCard via renderArtifactCard) that opens
  ArtifactDesigner on the card's source + resolved language, wiring saveArtifact from
  useArtifactLibrary. Verify the chat-code-block → card → designer → edit → save path.
  Update docs (artifacts guide) + i18n. `pnpm i18n:check`.

## IMPORTANT — designer is built but not yet REACHABLE

ArtifactDesigner exists and is fully tested, but nothing renders it yet. change-007 is
what wires it into the UI (the entry point) — until then the feature isn't user-visible.
That's the last step to a working end-to-end iterative editor.

## Backend / discipline

Native KBD; native-tool (claude-code, subagent-driven TDD). Per-change gate under Node 24
(`fnm use 24` first). Commit `--signoff --no-verify` (pre-commit hook uses old node; gates
verified manually under 24). Constraints: 1.9.x, never v2; loggerService not console; i18n
all strings (verify they RESOLVE, not just i18n:check); no new Redux/Dexie schema.
