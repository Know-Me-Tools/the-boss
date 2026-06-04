## ADDED Requirements

### Requirement: First-Class Artifact Library Navigation

The application MUST expose the stored artifact library and editor as a
first-class surface outside settings while preserving existing settings-based
artifact management.

#### Scenario: Artifact library route

- **WHEN** a user navigates to `/artifacts`
- **THEN** the application renders the stored artifact library surface
- **AND** stored HTML/HTMX and React artifacts can still open the artifact designer
- **AND** existing artifact settings management remains available under settings

#### Scenario: Artifact sidebar entry

- **WHEN** the left navigation sidebar is shown
- **THEN** an artifact navigation entry is available through sidebar configuration
- **AND** selecting the entry navigates to `/artifacts`
- **AND** the entry label is provided through i18n

#### Scenario: Existing customized sidebar preferences

- **WHEN** persisted sidebar preferences are migrated from a version without artifacts
- **THEN** the artifact entry is added without resetting existing visible or disabled icon preferences
- **AND** existing user ordering is preserved as much as practical

#### Scenario: Artifact mini-app/library entry

- **WHEN** the mini-app/library surface lists default app entries
- **THEN** an artifact entry is available
- **AND** selecting the artifact entry opens the internal `/artifacts` route
- **AND** existing external webview mini-app entries continue to open normally
