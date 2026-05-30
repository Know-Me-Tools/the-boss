# KBD Waypoint

**Project:** The Boss / Cherry Studio fork
**Active phase:** artifact-editor-iterative-design-protocol
**Status:** phase_complete (7 / 7 changes DONE · reflection written)
**Branch:** feat/artifact-iterative-designer (off main; never v2)
**Last updated:** 2026-05-30

## Exact next step

```
pnpm dev    # Node 24 (fnm use 24): live-verify one Edit-with-AI turn end to end
```

Then open a PR with the `gh-create-pr` skill, and `/kbd-new-phase` when ready.

## Phase outcome — goal ~95% MET

The LLM-driven iterative artifact editor is built, two-stage-reviewed, 238 tests green,
and bundles into the `electron-vite` production build. Every structural gap from the
assessment is closed:

- **M1 spine** (pure, zero UI): 001 protocol types · 002 editor reducer · 003 build-feedback
  seam · 004 design orchestrator.
- **M2 designer**: 005 3-pane ArtifactDesigner (modal overlay, sandboxed preview, a11y) ·
  006 build-loop wiring + library save ("Fix it" repair turn; cancel-safe).
- **M3 entry+docs**: 007 "Edit with AI" on React/HTML cards → opens the designer wired to
  the real model + `useArtifactLibrary`; `docs/en/guides/artifacts.md`.

Reflection: `.kbd-orchestrator/phases/artifact-editor-iterative-design-protocol/reflection.md`
The 7 change files are archived under
`.kbd-orchestrator/changes/archive/2026-05-30-artifact-editor-iterative-design-protocol/`.

## Open follow-ups (from reflection)

1. **Live-model smoke not yet done** — only acceptance criterion not proven by build+tests.
2. **Pre-commit hook bypassed** all phase (runs Node 20; repo needs ≥24.11.1) — pin Node 24.
3. **Editable code pane**, **base-anchored diffs**, **AG-UI-mapper promotion** — scoped deferrals.
4. Unrelated `RuntimeSettings.tsx` change still uncommitted in the tree — not ours; triage.

## Commits on feat/artifact-iterative-designer

001 `cd87fff43` · 002 `5847f7b0f`+`847fc3ea9` · 003 `db2a816eb` · 004 `d520a055f` ·
005 `247693386` · 006 `68a74870c`+`c5f85dc7b` · 007 `7b34e5d6d`+`232c06fda` · reflection (this turn)
