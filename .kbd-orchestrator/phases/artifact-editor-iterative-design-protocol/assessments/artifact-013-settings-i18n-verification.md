# Assessment - artifact-013-settings-i18n-verification

Phase: artifact-editor-iterative-design-protocol
Date: 2026-06-04
Backend: OpenSpec
Change: openspec/changes/artifact-013-settings-i18n-verification

## Scope

Assess the remaining settings, i18n, tests, and smoke-verification work for the
full artifact create-edit-refine-store workflow after artifact-008 through
artifact-012 are complete.

## Current Status

| Area | Status | Evidence |
| --- | --- | --- |
| Artifact settings storage | DONE | Existing `ArtifactSettingsSchema` includes runtime profile defaults, theme, access policy, package registry exposure, base CSS, and custom CSS. `useArtifactSettings` loads/saves through existing settings storage without Redux or DB schema changes. |
| Artifact settings page | PARTIAL | `ArtifactSettings/index.tsx` exposes runtime, theme, internet, package registry, CSS, service access, projected tools, package registry, and library sections. The service access section still contains hardcoded English strings. |
| Artifact library labels | DONE/PARTIAL | Library/editor labels use `settings.artifacts.*` keys for title, description, search, filters, actions, versions, preview loading, save/fork/rename/delete messages. Need final targeted i18n assertions. |
| Route and mini-app labels | DONE | `/artifacts` uses `title.artifacts`; sidebar labels map through `label.ts`; mini-app uses `minapps.artifacts`. |
| Conversation/card designer labels | DONE/PARTIAL | HTML/React artifact card and designer flows mostly use i18n keys. `ReactArtifactsCard` has a visible `React/TSX` badge and `ArtifactDesigner` uses `aria-label="artifact-source"`; these may be acceptable technical labels, but should be reviewed in execution. |
| Hardcoded artifact settings copy | MISSING/PARTIAL | `ArtifactSettings/index.tsx` has hardcoded visible strings: `Shared Service Access`, `Open Services`, `Legacy Service Access`, `Loading shared services...`, `No shared services are registered yet.`, `Projected Service Tools`, projected-tool description text, `Loading shared service tools...`, `No projected shared service tools are available yet.`, switch labels `Allowed` / `Blocked`, and projected-tool count text. |
| Locale key completeness | PARTIAL | `pnpm i18n:check` passes, but that does not catch the hardcoded artifact settings strings. Non-English artifact keys currently include `[to be translated]` placeholders from sync. |
| Tests for settings/i18n behavior | PARTIAL | There are focused tests for ArtifactDesigner, artifact cards, ArtifactLibrarySection, ArtifactsPage, sidebar, and mini-app route behavior. There is no focused `ArtifactSettings` page test covering service-access settings, projected tools, and i18n key usage. |
| OpenSpec delta | MISSING | `pnpm exec openspec validate artifact-013-settings-i18n-verification --strict` fails because the change has proposal/tasks only and no spec delta. |
| Final live smoke | MISSING | No current record of `pnpm dev` live smoke for HTML/HTMX and React create -> edit -> refine -> store after the productization changes. |

## Findings

The durable artifact workflow is mostly implemented before this final
verification change: storage/version updates, library-to-designer editing,
conversation entrypoints, navigation/mini-app entrypoints, and Prometheus skill
availability are all complete. `artifact-013` should therefore be a
verification-and-polish slice rather than a broad feature rewrite.

The clearest implementation gap is in
`src/renderer/src/pages/settings/ArtifactSettings/index.tsx`: the shared service
access section has hardcoded English UI copy and switch labels. That directly
violates the change purpose to remove hardcoded English from artifact settings
surfaces.

The current settings schema appears sufficient for the requested artifact
workflow settings. Runtime defaults, theme, internet access, service IDs,
projected tool IDs, package registry exposure, base CSS, and custom CSS are
already available through `ArtifactSettingsSchema`; no Redux slice, Dexie schema,
or SQLite schema change appears necessary from the assessment.

OpenSpec strict validation is not ready. Like artifact-012 before execution,
artifact-013 needs a spec delta with scenarios before final validation can pass.

Build health is currently good for i18n key completeness: `pnpm i18n:check`
passes. `pnpm i18n:hardcoded` exits 0 but reports unrelated ServicesSettings
placeholders; it does not report the artifact settings literals found by manual
scan. Full `pnpm lint`, `pnpm test`, and `pnpm format` last passed during
artifact-012 execution and must be rerun for artifact-013 after changes.

## Recommended Plan Direction

1. Add an OpenSpec delta for artifact settings/i18n/final smoke verification.
2. Replace hardcoded `ArtifactSettings/index.tsx` service-access copy and switch
   labels with `settings.artifacts.*` i18n keys.
3. Add/sync locale keys for those settings labels and descriptions.
4. Add focused tests for `ArtifactSettings` service access/projected tool
   rendering and settings updates, preferably asserting text through the
   translation mock keys.
5. Review technical display labels (`React/TSX`, `artifact-source`,
   kind/runtime tags) and either leave as technical identifiers or move to i18n
   where user-facing.
6. Run targeted tests, OpenSpec strict validation, `pnpm lint`, `pnpm test`,
   `pnpm format`.
7. Run `pnpm dev` smoke for HTML/HTMX and React create -> edit -> refine ->
   store, recording any failures or fixes.

## Constraints

Stay on the current 1.9.x codebase and do not use `v2`. Do not add Redux slices
or change Dexie/SQLite schemas without explicit approval. Keep implementation
focused on settings labels, targeted tests, OpenSpec completeness, and live
verification.

## Validation Baseline

- `pnpm i18n:check`: PASS.
- `pnpm i18n:hardcoded`: exits 0 but reports 11 unrelated
  `ServicesSettings/index.tsx` placeholders.
- `pnpm exec openspec validate artifact-013-settings-i18n-verification --strict`:
  FAIL due to missing spec delta.
