# artifact-009-library-designer-entry

## Purpose

Wire the stored artifact library into `ArtifactDesigner` so library artifacts can
be opened, refined over multiple turns, and saved back as managed versions.

## Scope

- Add library Edit with AI actions for stored artifacts.
- Load existing artifact source/runtime/theme into `ArtifactDesigner`.
- Save refinements through the update/version API from `artifact-008`.
- Refresh library state after save and expose current version context.
- Add focused component tests.

## Success Criteria

- A stored HTML/HTMX artifact can open in the designer from the library.
- A stored React artifact can open in the designer from the library.
- Saving a refinement updates the selected artifact instead of creating an unrelated record.
- Library rows reflect updated metadata/version state after save.
