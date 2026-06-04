## ADDED Requirements

### Requirement: Artifact settings service access copy is localized
Artifact settings MUST render service access, projected service tool, empty/loading, switch-state, and count labels through the i18n catalog rather than hardcoded visible English literals.

#### Scenario: Shared service access settings use i18n keys
- **GIVEN** the artifact settings page is opened
- **WHEN** shared services and projected service tools are displayed
- **THEN** section headings, descriptions, action labels, loading/empty states, allowed/blocked switch labels, and projected tool counts are resolved through `settings.artifacts.*` translation keys.

### Requirement: Artifact workflow settings continue to use existing settings state
Artifact workflow settings MUST continue to use the existing artifact settings state and storage shape unless a future change explicitly approves a schema or Redux update.

#### Scenario: Service access toggles update existing access policy fields
- **GIVEN** an artifact settings access policy has `serviceIds` and `serviceToolIds`
- **WHEN** a user toggles a legacy shared service or projected service tool
- **THEN** the existing artifact settings updater persists the new IDs through `accessPolicy.serviceIds` or `accessPolicy.serviceToolIds`.

### Requirement: Final artifact workflow verification is recorded
The implementation MUST record automated validation and live smoke outcomes for the HTML/HTMX and React create-edit-refine-store artifact workflow.

#### Scenario: Final verification records smoke coverage
- **GIVEN** the artifact productization changes are implemented
- **WHEN** final validation runs
- **THEN** targeted settings tests, i18n checks, OpenSpec strict validation, repo checks, and `pnpm dev` smoke results are recorded, including exact blockers if a real model turn cannot run locally.
