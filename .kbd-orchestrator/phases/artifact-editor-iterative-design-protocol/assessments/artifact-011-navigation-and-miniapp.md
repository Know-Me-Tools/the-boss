# Assessment — artifact-011-navigation-and-miniapp

**Phase:** artifact-editor-iterative-design-protocol
**Change:** artifact-011-navigation-and-miniapp
**Date:** 2026-06-03
**Author:** Codex (kbd-assess)
**Backend:** OpenSpec

## Scope

Assess whether the artifact library/editor is available as a first-class product
surface outside settings, including normal routing, left navigation, and
mini-app/library access.

## Current Status

| Requirement | Status | Evidence |
| --- | --- | --- |
| Artifact storage/editing implementation exists | MET | `ArtifactLibrarySection` lists stored artifacts, opens previews, launches `ArtifactDesigner`, and saves through `updateSource`. |
| Artifact settings surface exists | MET | `ArtifactSettings` is reachable under settings and embeds `ArtifactLibrarySection`. |
| Standalone artifact route/page exists | NOT MET | `Router.tsx` has routes for home, agents, apps, code, settings, etc.; no `/artifacts` route exists. |
| Left sidebar artifact icon exists | NOT MET | `SidebarIcon` union, `DEFAULT_SIDEBAR_ICONS`, label map, and `Sidebar` icon/path maps do not include an artifact entry. |
| Sidebar migration/backfill exists for artifacts | NOT MET | Existing migrations add/remove entries such as `notes`, `code_tools`, `openclaw`, and `agents`; no artifact sidebar migration exists. |
| Artifact launchpad/mini-app entry exists | NOT MET | `ORIGIN_DEFAULT_MIN_APPS` contains external web apps; no artifact/internal library app is registered. |
| Mini-app infrastructure supports local artifact page directly | PARTIAL | `MinAppType` requires `url`, and `MinAppPage`/`WebviewContainer` are webview-oriented. A route-backed or internal-app adapter is needed for a local artifact library surface. |
| Labels exist for artifact navigation and mini-app entry | PARTIAL | Settings artifact labels exist, but no sidebar/title/minapp labels for a first-class artifact surface were found. |
| Tests for sidebar/minapp migration behavior | PARTIAL | Existing tests cover minapp preservation and some settings pages, but no artifact sidebar/default/migration tests exist. |

## Dependencies Already Satisfied

- `artifact-008-storage-version-update` is DONE, so stored artifacts can be updated/versioned.
- `artifact-009-library-designer-entry` is DONE, so stored artifacts can launch `ArtifactDesigner` from the library.
- `artifact-010-conversation-entrypoints` is DONE, so conversation-created artifacts have regression coverage.
- The app already has reusable routing and sidebar patterns in `Router.tsx`, `config/sidebar.ts`, `components/app/Sidebar.tsx`, and `i18n/label.ts`.
- The minapp list has preservation logic in `useMinapps`, reducing risk when adding a new default entry if the data shape stays unchanged.

## Implementation Gaps

1. Add a standalone artifact library page, likely by reusing `ArtifactLibrarySection` and moving shared page chrome out of settings-only assumptions.
2. Add a `/artifacts` route in `Router.tsx`.
3. Add `artifacts` to the `SidebarIcon` union and sidebar default/configuration maps.
4. Add a migration/backfill for persisted `settings.sidebarIcons` so existing users can see or manage the new artifact icon without losing hidden-icon preferences.
5. Add labels for page title, sidebar label, and mini-app/library entry.
6. Decide and implement the mini-app strategy:
   - route-backed internal entry, or
   - a specialized local mini-app adapter, or
   - a launchpad entry that navigates to `/artifacts` instead of creating a webview.
7. Add focused tests for route registration, sidebar icon/default behavior, migration/backfill behavior, and mini-app/internal-entry behavior.

## Constraints

- Do not add Redux slices.
- Do not change Dexie, SQLite, or artifact library schema.
- `src/renderer/src/store/settings.ts`, `src/renderer/src/store/minapps.ts`, and `src/renderer/src/store/tabs.ts` carry v2 refactor block headers; keep any required edits narrow and compatibility-focused.
- Keep all user-visible labels in i18next.
- Keep existing settings artifact management available.
- Stay on the current 1.9.x base; do not use `v2`.

## Recommended Execution Notes

- Prefer a thin page wrapper around existing artifact library componentry over duplicating storage/editor logic.
- Avoid creating a new persisted store shape for artifact navigation.
- Treat mini-app support as the highest-risk part of this change: the current default mini-apps are external webview entries, not local React page entries.
- If local mini-app support requires broad minapp infrastructure changes, scope the change to a route-backed launchpad/library entry and document the deferred webview-style mini-app behavior for `artifact-013`.

## Build Health

No build, lint, format, or test command was run in this assessment pass. The previous completed change (`artifact-010`) passed targeted renderer tests, `pnpm lint`, `pnpm test`, `pnpm format`, and strict OpenSpec validation.

ASSESSMENT COMPLETE
