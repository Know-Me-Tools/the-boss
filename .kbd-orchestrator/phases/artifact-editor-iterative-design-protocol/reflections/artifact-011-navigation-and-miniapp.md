# Reflection — artifact-011-navigation-and-miniapp

**Phase:** artifact-editor-iterative-design-protocol
**Change:** artifact-011-navigation-and-miniapp
**Date:** 2026-06-04
**Author:** Codex (kbd-reflect)
**Status:** DONE

## Delta

- The change achieved the planned route/sidebar/mini-app scope, but the mini-app
  implementation intentionally chose route-backed internal navigation rather
  than embedding the artifact library inside the existing webview mini-app
  runtime.
- The phase remains incomplete: `artifact-012-prometheus-skill-sync` and
  `artifact-013-settings-i18n-verification` are still pending.
- Live Electron browser smoke was not performed in this change-level
  reflection. Validation is unit/integration tests, OpenSpec, lint, test, and
  format.

## Root Cause

The existing mini-app infrastructure is webview-first (`MinAppPage`, popup
containers, and keep-alive webview pools). Forcing a local React artifact editor
into that runtime would have broadened the change beyond the OpenSpec scope and
risked persistence/runtime regressions. A route-backed internal mini-app entry
satisfied the user-visible library entrypoint while preserving external webview
behavior.

## Corrective Actions

- Keep `artifact-013-settings-i18n-verification` responsible for live UI/browser
  verification and any polish found after running the app.
- Keep future internal mini-app additions behind the same optional `route` field
  unless a dedicated internal-app abstraction is designed.
- Do not archive or close the full phase yet; proceed to
  `artifact-012-prometheus-skill-sync`.

## Goal Achievement

| Goal | Result |
| --- | --- |
| Artifact library reachable through `/artifacts` | MET |
| Left navigation can expose an artifact entry | MET |
| Existing settings artifact management remains available | MET |
| Existing sidebar preferences are preserved by migration | MET |
| Mini-app/library surface exposes artifact access | MET |
| Existing external webview mini-app behavior remains unchanged | MET |
| No Redux slice or database schema changes | MET |

Overall change achievement: **100%** for the scoped navigation and mini-app
access change.

## Delivered Changes

- Added `ArtifactsPage` as a standalone route wrapper around
  `ArtifactLibrarySection` and `useArtifactSettings`.
- Registered `/artifacts` in the renderer router.
- Added `artifacts` to sidebar types, defaults, runtime icon/path maps, display
  settings icon manager, and label maps.
- Added migration `210` with a pure `backfillArtifactsSidebarIcon` helper that
  inserts artifacts without resetting visible/disabled preferences.
- Added an `artifacts` default mini-app entry with optional `route: '/artifacts'`
  metadata.
- Updated mini-app click/opening paths so route-backed apps navigate internally
  and are filtered out of webview pools.
- Added i18n keys for `title.artifacts` and `minapps.artifacts` across locale
  files.
- Added focused tests for sidebar defaults/backfill, mini-app registration,
  route-backed mini-app navigation, and artifacts page rendering.

## Artifact Quality Summary

| Metric | Value |
| --- | --- |
| Changes with QA | 1/1 |
| First-pass pass rate | 1/1 (100%) |
| Changes requiring refinement | 0 |
| Total refinement iterations | 0 |

### Constraint Violations

None recorded.

### QA Evidence

- Refiner log:
  `.refiner/artifacts/artifact-011-navigation-and-miniapp/refinement_log.md`.
- Targeted renderer tests: 6 passed.
- `pnpm exec openspec validate artifact-011-navigation-and-miniapp --strict`:
  passed.
- `pnpm lint`: passed on Node 24.16.0.
- `pnpm test`: 345 files passed, 5193 tests passed, 72 skipped.
- `pnpm format`: passed.

## Technical Debt

- Route-backed mini-app support is currently represented by an optional `route`
  field on `MinAppType`, not a full internal-app abstraction. This is
  appropriate for the scoped change, but future internal apps may need a clearer
  `kind` or app launcher model.
- The artifact mini-app icon reuses the generic application asset rather than a
  bespoke artifact asset. This is acceptable for access wiring, but visual
  polish can be revisited in `artifact-013`.
- Live Electron smoke for the `/artifacts` route and launchpad/sidebar click
  path is deferred to `artifact-013-settings-i18n-verification`.

## Architecture Integrity

- AGENTS.md violations: NONE found. Work stayed on 1.9.x, avoided `v2`, did not
  add Redux slices, and did not change Dexie/SQLite/artifact record schemas.
- Constraint violations: NONE recorded in the QA log.
- Persisted-state change was limited to a versioned Redux migration for sidebar
  preference backfill.

## Lessons

- Internal route-backed mini-apps should bypass the webview keep-alive pools at
  every entry point, not only from the app grid click handler.
- Keeping sidebar migration logic as a pure helper made preference preservation
  testable without importing the full store migration module.
- `pnpm i18n:sync` is required after adding locale keys because `pnpm lint`
  enforces sorted i18n templates through `i18n:check`.
- Node 24 must be placed first on PATH for this repo; otherwise pnpm fails the
  engine check with the default Node 22 shim.

## Next Focus

Proceed to `artifact-012-prometheus-skill-sync`: normalize Prometheus
skill-system references and runtime availability before the final
settings/i18n/live-verification pass.
