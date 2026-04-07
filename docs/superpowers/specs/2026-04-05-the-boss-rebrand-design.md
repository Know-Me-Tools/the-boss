# The Boss Rebrand Design

**Goal**

Rebrand the The Boss application as `The Boss` for all user-facing surfaces while preserving upstream mergeability by keeping compatibility-sensitive package names, import paths, provider IDs, and protocol-level code symbols intact unless they are part of the install/runtime app identity.

**Compatibility Boundary**

- Keep workspace package names such as `@cherrystudio/*` unchanged.
- Keep provider IDs and feature identifiers such as `cherryin`, `cherryai`, `CherryIN`, and IPC channel names unchanged unless they are purely display-facing.
- Keep internal code structure aligned with upstream patterns.
- Allow changes to install/runtime identity that must be separated from The Boss:
  - app display name
  - bundle/app ID
  - executable and desktop names
  - protocol display metadata
  - updater/release endpoints
  - storage containers and temp/export defaults

**Branding Model**

Introduce a small centralized branding configuration that exposes:

- display name: `The Boss`
- internal slug for app/runtime identity: `the-boss`
- bundle identifier: `com.knowmetools.theboss`
- desktop/runtime container names used for storage separation
- public URLs for website, docs, releases, issues, and repo

This layer should be used wherever practical for runtime and UI-facing app identity. Static documentation and locale assets may be updated directly when that is simpler.

**Scope**

1. App/runtime identity
- Electron builder metadata
- app name at runtime
- tray text, menu text, HTML titles, About page, onboarding, visible labels
- separate storage containers for dev and packaged app
- temp/export/autostart/protocol desktop file names where the app identity is exposed

2. User-facing app text
- locale strings that mention `The Boss`
- built-in assistant descriptions/prompts that identify the product
- visible source/export labels and backup filenames

3. Distribution and support links
- repository links
- releases/issues/docs/website links
- updater feed/config endpoints
- privacy/license/support pages bundled with the app

4. Repo/documentation branding
- root README and project docs
- package metadata descriptions/homepages where they are repo-facing rather than compatibility-sensitive code symbols

**Non-Goals**

- Renaming package scopes, imports, or workspace package names
- Renaming provider IDs such as `cherryin` / `cherryai`
- Refactoring unrelated app architecture

**Implementation Strategy**

1. Add centralized brand constants used by main/shared/renderer.
2. Update install/runtime identity and storage separation first so The Boss is isolated from The Boss.
3. Switch menu/tray/About/runtime surfaces to the new brand constants.
4. Sweep locale JSON, bundled HTML, built-in agent copy, docs, and repo links.
5. Update tests that assert the old app name or old URLs.

**Risks**

- Over-replacing `TheBoss` could break compatibility-sensitive paths and identifiers.
- Updater/feed changes can silently break update checks if only partially migrated.
- Locale-wide replacements can affect examples and placeholders that must now use `the-boss` paths instead of `the-boss`.

**Mitigations**

- Prefer targeted edits for code files and broad replacements only in locale/docs/static content.
- Centralize URLs and app identity in shared constants.
- Run `pnpm lint`, `pnpm test`, and `pnpm format` after the sweep and fix the failing assertions.
