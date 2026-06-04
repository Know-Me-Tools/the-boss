# artifact-008-storage-version-update

## Purpose

Add durable source update/version persistence for stored artifacts so iterative
refinement can edit an existing HTML/HTMX or React artifact instead of always
creating an unrelated library record.

## Scope

- Extend shared artifact request/response schemas for source updates.
- Add main-process `ArtifactService` update/append-version behavior.
- Add IPC, preload, and renderer API wrappers.
- Preserve the existing artifact record shape and version history where possible.
- Add focused service and IPC/API tests.

## Out of Scope

- New Redux slices.
- Dexie or SQLite schema changes unless the user explicitly approves them.
- Multi-file artifact project trees.

## Success Criteria

- Stored artifact source can be updated while appending a new version.
- The latest source and metadata reflect the newest version.
- Unknown IDs and invalid source updates fail with clear errors.
- Existing save/list/get/fork/delete behavior remains compatible.
