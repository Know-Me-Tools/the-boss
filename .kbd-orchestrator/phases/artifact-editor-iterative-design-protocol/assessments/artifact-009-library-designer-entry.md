# Assessment — artifact-009-library-designer-entry

**Phase:** artifact-editor-iterative-design-protocol
**Change:** artifact-009-library-designer-entry
**Date:** 2026-06-03
**Author:** Codex (kbd-assess)
**Backend:** OpenSpec

## Scope

Assess the gap between the current stored artifact library behavior and the
OpenSpec goal: library artifacts should open in `ArtifactDesigner`, refine over
multiple turns, and save back to the same stored artifact through the
`artifact-008` update/version API.

## Current Status

| Requirement | Status | Evidence |
| --- | --- | --- |
| Library rows expose an Edit with AI action | NOT MET | `ArtifactLibrarySection` exposes open, copy, fork, rename, and delete actions only. |
| Stored HTML/HTMX artifacts open in `ArtifactDesigner` | NOT MET | Library open path mounts `ArtifactPopup`, not `ArtifactDesigner`. |
| Stored React artifacts open in `ArtifactDesigner` | NOT MET | React preview compiles through `ArtifactPopup`; no stored React designer path exists. |
| Existing artifact context is passed into designer | PARTIAL | Library has `ArtifactRecord` context and preview builder data, but `ArtifactDesigner` only accepts generic create/save props. |
| Save refinement updates existing artifact | NOT MET | Current library `handlePreviewSave` only updates local preview state; chat-card designer saves create new records through `saveArtifact`. |
| Refresh library after refinement save | PARTIAL | `useArtifactLibrary.updateSource` reloads after save, but it is not used by the library designer flow yet. |
| Version state visible after save | PARTIAL | Rows show `artifact.versions.length`; no designer save path updates the selected row yet. |
| Focused tests for library edit flows | NOT MET | No `ArtifactLibrarySection` component tests were found. Existing designer/card tests cover chat-card entry only. |

## Dependencies Already Satisfied

- `artifact-008-storage-version-update` is DONE.
- `UpdateArtifactSourceRequestSchema` exists.
- `ArtifactService.updateArtifactSource` appends versions and updates latest source metadata.
- `window.api.artifacts.updateSource` is exposed.
- `useArtifactLibrary.updateSource` reloads library state after update.

## Implementation Gaps

1. Add a distinct Edit with AI action to stored artifact rows/cards.
2. Mount `ArtifactDesigner` from `ArtifactLibrarySection` for the selected stored artifact.
3. Reuse the existing async preview builders for HTML/HTMX and React designer previews.
4. Extend or wrap the designer save seam so stored-artifact saves call `updateSource`, not `saveArtifact`.
5. Preserve the stored artifact's runtime profile, theme, access policy, source language, and origin when saving an updated source.
6. Refresh selected artifact/list state after save so version count and latest source are current.
7. Add focused renderer tests for HTML/HTMX and React library edit flows, including the regression that save does not create a new artifact.

## Constraints

- Do not add Redux slices.
- Do not change Dexie, SQLite, or artifact library schema.
- Keep user-visible labels in i18next.
- Use `loggerService` for any logging; no `console.log`.
- Stay on the current 1.9.x base; do not use `v2`.

## Recommended Execution Notes

- Prefer adding a stored-artifact update seam to `ArtifactDesigner`, for example an optional `saveArtifactUpdate` prop or a more general save callback that can accept the current source and return `{ id }`.
- Keep chat-card designer behavior unchanged: chat-created artifacts should continue to create new library records.
- For library-origin artifacts, set the saved ID to the existing artifact ID so the designer saved indicator still works.
- The first practical test target is a new `ArtifactLibrarySection.test.tsx` with `ArtifactDesigner` mocked in the same style as `ArtifactCardsDesigner.test.tsx`.

## Build Health

No build, lint, format, or test command was run in this assessment pass. The previous completed change (`artifact-008`) passed `pnpm lint`, `pnpm test`, and `pnpm format`.

ASSESSMENT COMPLETE
