# Plan — Artifact Editor Productization and Skill-System Integration

**Phase:** artifact-editor-iterative-design-protocol
**Date:** 2026-06-03
**Author:** Codex (kbd-plan)
**Backend:** OpenSpec change records (`openspec/changes/*`)
**Inputs:** [assessment.md](./assessment.md) · [progress.json](./progress.json)
**Base:** current 1.9.x line. Do not use `v2`.

## Backend Decision

OpenSpec is active for this planning pass because `openspec/` exists at the
project root. The prior v1 artifact plan used native KBD change files and is
already complete; this re-plan creates OpenSpec records for the broader product
workflow requested in the 2026-06-03 assessment.

No evolver plan was found under `.evolver/`, so no evolver bridge is needed.

## Strategy

Keep the existing v1 designer spine and add the missing product workflow around
it. The implementation order starts with persistence because every editing
surface needs a durable update/version API. It then wires stored-library editing,
conversation entry points, navigation/mini-app access, Prometheus skill-system
availability, and finally settings/i18n/end-to-end verification.

Any Redux state-shape or database schema change is explicitly approval-gated by
AGENTS.md. Prefer existing persisted settings, existing `minapps` state, current
artifact JSON library storage, and existing IPC surfaces unless the user approves
a broader schema change in writing.

Recommended working branch: `feat/artifact-productization-skill-system`.

## Ordered Change List

| # | Change ID | Title | Depends on | Recommended agent |
|---|---|---|---|---|
| 1 | `artifact-008-storage-version-update` | Persist source edits and append artifact versions | — | tdd-guide -> code-reviewer |
| 2 | `artifact-009-library-designer-entry` | Open stored artifacts in `ArtifactDesigner` and save refinements | 008 | frontend-app-builder -> a11y-audit |
| 3 | `artifact-010-conversation-entrypoints` | Verify and wire assistant plus agent conversation Edit with AI entries | 008,009 | chat-ui -> code-reviewer |
| 4 | `artifact-011-navigation-and-miniapp` | Add first-class artifact library route, sidebar entry, and mini-app surface | 009 | frontend-app-builder -> a11y-audit |
| 5 | `artifact-012-prometheus-skill-sync` | Normalize Prometheus skill-system references and runtime availability | — | dependency-auditor -> code-reviewer |
| 6 | `artifact-013-settings-i18n-verification` | Complete artifact settings, labels, and end-to-end verification | 008,009,010,011,012 | code-reviewer -> browser-testing-with-devtools |

## Change Details

### artifact-008-storage-version-update

Add an update/append-version path to `ArtifactService`, shared request schemas,
IPC handlers, preload/api wrappers, and focused tests. Preserve the existing
record shape and `versions` array where possible. Do not introduce Dexie,
SQLite, or Redux shape changes without separate approval.

### artifact-009-library-designer-entry

Let stored artifacts open directly in `ArtifactDesigner` from the library. A
refinement should update the selected artifact source through change 008 instead
of creating an unrelated new record. The library should refresh after save and
make version state visible enough for management.

### artifact-010-conversation-entrypoints

Ensure assistant and agent conversation renderers both expose the artifact Edit
with AI workflow for HTML/HTMX and React artifacts. Add regression coverage for
the card/entry behavior and verify agent outputs do not fall through to plain
code-only rendering.

### artifact-011-navigation-and-miniapp

Add a first-class artifact library/editor surface reachable outside settings:
route, sidebar icon configuration, and a registered mini-app/library entry. Reuse
existing sidebar/minapp store shapes and migration patterns.

### artifact-012-prometheus-skill-sync

Resolve the single source of truth for `resources/skills/prometheus-skill-system`
and related embedded references, then ensure artifact-refiner, KBD process
skills, and shared utilities are discoverable through the app's built-in skill
sync/check paths. Add tests around nested skill discovery and scope availability.

### artifact-013-settings-i18n-verification

Complete user-visible labels for all new artifact surfaces and remove hardcoded
artifact settings copy. Add or update settings for artifact workflow behavior
only through existing settings mechanisms unless approval is granted for a shape
change. Finish with targeted tests, `pnpm lint`, `pnpm test`, and `pnpm format`;
then run a live `pnpm dev` smoke for create -> edit -> refine -> store.

## OpenSpec Records

- `openspec/changes/artifact-008-storage-version-update`
- `openspec/changes/artifact-009-library-designer-entry`
- `openspec/changes/artifact-010-conversation-entrypoints`
- `openspec/changes/artifact-011-navigation-and-miniapp`
- `openspec/changes/artifact-012-prometheus-skill-sync`
- `openspec/changes/artifact-013-settings-i18n-verification`

## Completion Gates

- Stay on the current 1.9.x base; never use `v2`.
- No new Redux slices and no database schema changes without explicit approval.
- All logging through `loggerService`; no `console.log`.
- All user-visible strings through i18next.
- Per change: focused tests first, then relevant targeted checks.
- Before completion: `pnpm lint`, `pnpm test`, and `pnpm format`.
- Commits must be signed off and use Conventional Commit messages.
