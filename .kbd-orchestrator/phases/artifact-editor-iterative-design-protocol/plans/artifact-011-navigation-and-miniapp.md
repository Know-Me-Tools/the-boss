# Plan — artifact-011-navigation-and-miniapp

**Phase:** artifact-editor-iterative-design-protocol
**Change:** artifact-011-navigation-and-miniapp
**Date:** 2026-06-04
**Author:** Codex (kbd-plan)
**Backend:** OpenSpec
**Model class:** medium/frontier coding model
**Complexity:** M
**Customer value:** HIGH

## Goal

Make the stored artifact library and editor a first-class product surface outside
settings. Users should be able to reach the artifact library from normal app
routing, left navigation, and the mini-app/library surface while preserving the
existing settings management page.

## Current Inputs

- Assessment:
  `.kbd-orchestrator/phases/artifact-editor-iterative-design-protocol/assessments/artifact-011-navigation-and-miniapp.md`
- OpenSpec change:
  `openspec/changes/artifact-011-navigation-and-miniapp`
- Sycophancy audit:
  `.kbd-orchestrator/phases/artifact-editor-iterative-design-protocol/sycophancy/plan-artifact-011-navigation-and-miniapp-2026-06-04T08-47-30Z.json`

## Implementation Strategy

Implement one renderer vertical slice. Reuse the existing
`ArtifactLibrarySection`, `ArtifactDesigner`, artifact config, and artifact
storage/update behavior. Do not duplicate artifact persistence logic and do not
change Redux slice shape, Dexie schema, SQLite schema, or artifact record shape.

The mini-app surface is the only design-sensitive area. Current mini-apps are
external webview entries, so the planned implementation is a route-backed
internal app entry that navigates to `/artifacts`. This has lower blast radius
than converting `MinAppPage` and `WebviewContainer` to render local React pages.

## Ordered Tasks

1. Add a standalone artifacts page.
   - Create a route-ready page wrapper, likely
     `src/renderer/src/pages/artifacts/ArtifactsPage.tsx`.
   - Load settings via `useArtifactSettings`.
   - Reuse `ArtifactLibrarySection` so stored artifact preview, designer launch,
     source update, and version behavior stay centralized.
   - Use existing app page chrome/layout conventions instead of settings-only
     layout assumptions.

2. Register the route.
   - Add `/artifacts` to `src/renderer/src/Router.tsx`.
   - Keep existing `/settings/artifacts` behavior unchanged.

3. Add left navigation support.
   - Add `artifacts` to `SidebarIcon`.
   - Add `artifacts` to `DEFAULT_SIDEBAR_ICONS` in a discoverable order near
     creation/library surfaces.
   - Add icon and path entries in `components/app/Sidebar.tsx`.
   - Add icon support in `DisplaySettings/SidebarIconsManager.tsx`.
   - Add label support through `i18n/label.ts` and locale keys.

4. Add sidebar migration/backfill.
   - Add a narrow `store/migrate.ts` migration for persisted
     `settings.sidebarIcons`.
   - Insert `artifacts` when missing without wiping customized visible/disabled
     lists.
   - Preserve user ordering as much as practical. Prefer insertion near
     `minapp`, `files`, or `notes`; append only when no anchor exists.
   - Do not add a Redux slice or alter unrelated persisted state.

5. Register mini-app/library access.
   - Add an internal/route-backed artifact entry to default mini-app config.
   - Extend `MinAppType` only with optional route/internal metadata if needed.
   - Update mini-app click handling so route-backed apps navigate to
     `/artifacts` instead of opening a webview/popup.
   - Keep custom mini-app behavior and existing external webview behavior
     unchanged.

6. Add i18n labels.
   - Add page title, sidebar label, and mini-app label keys.
   - Keep all visible text in i18next.

7. Add focused tests.
   - Sidebar default and label tests for `artifacts`.
   - Migration/backfill test that preserves customized sidebar settings.
   - Mini-app route-backed navigation test.
   - Artifacts page smoke test where practical, mocking artifact settings/storage.

8. Validate.
   - Run targeted renderer tests for changed units first.
   - Run `openspec validate artifact-011-navigation-and-miniapp --strict`.
   - Run `pnpm lint`.
   - Run `pnpm test`.
   - Run `pnpm format`.

## Risks And Decisions

- **Mini-app behavior:** Route-backed mini-app navigation is selected because
  the existing default mini-app infrastructure is webview-first. Rendering a
  local React artifact editor inside the webview pipeline would create broad
  routing/runtime risk for this change.
- **Persisted sidebar preferences:** Existing users may have customized sidebar
  icon lists. The migration must add the new entry without resetting hidden
  icons or user order.
- **Blocked store files:** `settings`, `minapps`, and `tabs` store files are in
  the 1.9.x refactor-sensitive area. Any required edits should remain narrow
  compatibility/migration changes.
- **Artifact state:** This change should not create a new artifact state store.
  The artifact library/editor behavior already exists and should remain the
  source of truth.

## Execution Recommendation

Use `frontend-app-builder -> a11y-audit` for implementation and verification,
with Codex performing the focused code changes and tests in the existing 1.9.x
codebase.

## Next Command

```sh
/kbd-execute artifact-011-navigation-and-miniapp
```
