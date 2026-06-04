# Tasks

- [x] Add a focused `ArtifactLibrarySection` renderer test harness with mocked library hook, `ArtifactDesigner`, preview builders, and artifact IPC.
- [x] Inspect and preserve existing `ArtifactLibrarySection`, `ArtifactPopup`, and `ArtifactDesigner` data flow.
- [x] Add a stored-artifact Edit with AI entry from library rows/cards without changing the existing Open preview action.
- [x] Pass stored artifact context into `ArtifactDesigner`: title, latest source, source language, runtime profile, theme, access policy, and origin.
- [x] Persist designer saves through `useArtifactLibrary.updateSource` / `window.api.artifacts.updateSource`, not `saveArtifact`.
- [x] Refresh list/detail state after save and keep version count/latest source coherent.
- [x] Add component tests for HTML/HTMX and React library edit flows, including the regression that stored edits do not create a new artifact.
- [x] Run targeted renderer tests, then `pnpm lint`, `pnpm test`, and `pnpm format`.
