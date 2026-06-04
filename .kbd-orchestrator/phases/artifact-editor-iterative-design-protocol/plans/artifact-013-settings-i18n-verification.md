# Plan - artifact-013-settings-i18n-verification

**Phase:** artifact-editor-iterative-design-protocol
**Change:** artifact-013-settings-i18n-verification
**Date:** 2026-06-04
**Author:** Codex (kbd-plan)
**Backend:** OpenSpec
**Model class:** medium/frontier coding model
**Complexity:** M
**Customer value:** HIGH

## Goal

Close the final artifact workflow verification slice by localizing remaining
artifact settings copy, adding targeted settings/i18n tests, making the OpenSpec
change strict-valid, and recording final live smoke coverage for HTML/HTMX and
React create-edit-refine-store workflows.

## Current Inputs

- Assessment:
  `.kbd-orchestrator/phases/artifact-editor-iterative-design-protocol/assessments/artifact-013-settings-i18n-verification.md`
- OpenSpec change:
  `openspec/changes/artifact-013-settings-i18n-verification`
- Sycophancy audit:
  `.kbd-orchestrator/phases/artifact-editor-iterative-design-protocol/sycophancy/plan-artifact-013-settings-i18n-verification-2026-06-04T11-53-17Z.json`
- Prior reflection:
  `.kbd-orchestrator/phases/artifact-editor-iterative-design-protocol/reflections/artifact-012-prometheus-skill-sync.md`

## Implementation Strategy

Treat the existing artifact settings schema and settings storage as sufficient.
Do not add Redux slices or database schema changes. This change should be a
final verification and polish pass: localize remaining `ArtifactSettings` copy,
add focused tests, add the missing OpenSpec delta, run full repo checks, and
perform a live dev smoke.

Keep technical identifiers such as runtime profile IDs, service kinds, and
package names as data labels unless they are descriptive prose. The assessment's
concrete i18n gap is the hardcoded service-access section in
`ArtifactSettings/index.tsx`.

## Ordered Tasks

1. Add the missing OpenSpec delta.
   - Create a spec delta under
     `openspec/changes/artifact-013-settings-i18n-verification/specs/`.
   - Cover artifact settings i18n, existing settings-state usage, targeted
     tests, and live smoke evidence.
   - Verify strict validation after the implementation pass.

2. Localize remaining `ArtifactSettings` service-access copy.
   - Replace hardcoded visible text in
     `src/renderer/src/pages/settings/ArtifactSettings/index.tsx` with
     `settings.artifacts.*` keys.
   - Include section title, Open Services button, legacy service heading,
     loading/empty service messages, projected tools heading, projected tools
     description, loading/empty tool messages, Allowed/Blocked switch labels,
     and projected tool count text.
   - Leave true data/technical values such as service names, endpoints, runtime
     IDs, service kinds, and package names as data labels.

3. Sync i18n locale files.
   - Add keys to `en-us` and run the repo i18n sync flow so required
     locale/translate files receive matching keys.
   - Do not hand-translate all languages unless the existing project flow
     requires it; synced placeholders are acceptable if consistent with prior
     artifact changes.

4. Add focused `ArtifactSettings` tests.
   - Add or extend tests under
     `src/renderer/src/pages/settings/ArtifactSettings/__tests__/`.
   - Mock services, projected tools, artifact settings, and artifact runtime
     APIs.
   - Assert service-access/projected-tool text comes through translation keys
     and switch interactions update existing settings fields:
     `accessPolicy.serviceIds` and `accessPolicy.serviceToolIds`.
   - Add a guard that the previously hardcoded strings do not appear as raw
     English literals when the translation mock returns keys.

5. Review remaining artifact visible labels.
   - Re-scan artifact settings, route, mini-app, library, and card/designer
     surfaces.
   - Decide whether `React/TSX`, artifact kind/runtime tags, and
     `artifact-source` are technical/data labels or should be localized.
   - Make only narrow fixes that are clearly user-facing copy.

6. Validate in layers.
   - Run targeted renderer tests for `ArtifactSettings` and adjacent artifact
     surfaces.
   - Run `pnpm i18n:check` and `pnpm i18n:hardcoded`, documenting unrelated
     `ServicesSettings` findings if still present.
   - Run `pnpm exec openspec validate artifact-013-settings-i18n-verification
     --strict`.
   - Run `pnpm lint`, `pnpm test`, and `pnpm format`.

7. Run live dev smoke.
   - Start `pnpm dev` with Node 24 and verify the finalized artifact workflow in
     the app.
   - Smoke HTML/HTMX create -> Edit with AI -> refine -> save/store.
   - Smoke React create -> Edit with AI -> refine -> save/store.
   - Record the exact smoke outcome in the execution and QA/refiner records; fix
     any blocking issues found.

## Risks And Decisions

- **Live smoke:** May need model/API configuration or manual interaction. If a
  real model turn cannot be completed in the environment, record the blocker
  with exact reason and complete all automatable checks.
- **Existing hardcoded-string findings:** `pnpm i18n:hardcoded` currently
  reports unrelated `ServicesSettings` placeholders. Treat them as pre-existing
  unless artifact execution touches that file.
- **Scope control:** Do not broaden the change into service settings cleanup,
  database migrations, or artifact schema changes.

## Execution Recommendation

Use `code-reviewer -> browser-testing-with-devtools` with Codex performing the
focused code/test/i18n updates and using the in-app browser or dev server for
smoke verification.

## Next Command

```sh
/kbd-execute artifact-013-settings-i18n-verification
```
