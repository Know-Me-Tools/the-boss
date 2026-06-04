# Plan — artifact-009-library-designer-entry

**Phase:** artifact-editor-iterative-design-protocol
**Change:** artifact-009-library-designer-entry
**Date:** 2026-06-03
**Author:** Codex (kbd-plan)
**Backend:** OpenSpec
**Assessment:** `.kbd-orchestrator/phases/artifact-editor-iterative-design-protocol/assessments/artifact-009-library-designer-entry.md`
**OpenSpec:** `openspec/changes/artifact-009-library-designer-entry`

## Backend Decision

Use the existing OpenSpec change record. Root `openspec/` is present and the
phase progress records `change_backend: "openspec"`. No `.evolver/` plan was
found, so no evolver bridge is needed.

## Goal

Stored HTML/HTMX and React artifacts in the artifact library should open in
`ArtifactDesigner`, support multiple refinement turns, and save back to the
same artifact through `useArtifactLibrary.updateSource` / `window.api.artifacts.updateSource`.

## Ordered Implementation Plan

| # | Task | Files | Notes |
| --- | --- | --- | --- |
| 1 | Establish renderer test harness for stored-library edit flows | `src/renderer/src/pages/settings/ArtifactSettings/__tests__/ArtifactLibrarySection.test.tsx` | Mock `useArtifactLibrary`, `ArtifactDesigner`, preview builders, `window.api.artifacts.compileReact`, and i18n. Cover both HTML and React records. |
| 2 | Add stored artifact designer state to the library section | `ArtifactLibrarySection.tsx` | Track a selected designer artifact separately from the existing preview popup selection. |
| 3 | Add Edit with AI row action | `ArtifactLibrarySection.tsx`, i18n locale files if a new label is required | Use the existing `settings.artifacts.designer.edit_with_ai` key if appropriate. Keep Open/preview behavior intact. |
| 4 | Mount `ArtifactDesigner` from the library | `ArtifactLibrarySection.tsx` | Pass title, `latestSource`, source language, type label, and an async preview builder that reuses the current HTML/React preview logic. |
| 5 | Save through update/version API | `ArtifactLibrarySection.tsx`, possibly `ArtifactDesigner.tsx` | Prefer a new stored-update save seam only if needed. The save must call `updateSource` with existing artifact id, source language, runtime profile, theme, access policy, and origin. It must not call `saveArtifact` for stored edits. |
| 6 | Refresh selected artifact state after save | `ArtifactLibrarySection.tsx`, `useArtifactLibrary.ts` only if needed | `updateSource` already reloads list state; ensure the modal and row reflect the updated source/version count without stale selected artifact state. |
| 7 | Run targeted renderer tests and required checks | tests/config as needed | Target new library tests first, then `pnpm lint`, `pnpm test`, and `pnpm format` under Node >=24.11.1. |

## Test Plan

- New component test: stored HTML artifact row exposes Edit with AI and opens mocked `ArtifactDesigner`.
- New component test: stored React artifact row opens designer with `language="tsx"` or the stored source language.
- New component test: designer save for a stored artifact calls `updateSource`, not `saveArtifact`.
- New component test: update payload preserves id, source language, runtime profile, theme, access policy, and origin.
- New component test: after update, the library reload/update path is invoked and the modal remains coherent or closes intentionally.
- Regression: Open preview still uses `ArtifactPopup` and does not launch designer.

## Constraints

- Do not add Redux slices.
- Do not change Dexie, SQLite, or artifact library schema.
- Do not route stored artifact edits through `saveArtifact`; that would create unrelated records.
- Keep chat-card designer behavior unchanged.
- Keep all user-visible strings in i18next.
- Stay on current 1.9.x; do not use `v2`.

## Completion Criteria

- OpenSpec tasks for `artifact-009-library-designer-entry` are checked off.
- `progress.json` marks `artifact-009-library-designer-entry` as `DONE`.
- Artifact-refiner QA is recorded because this change is expected to touch more than three files.
- Required checks pass: `pnpm lint`, `pnpm test`, `pnpm format`.
