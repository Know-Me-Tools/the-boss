# artifact-013-settings-i18n-verification

## Purpose

Complete settings, language files, and verification for the full artifact
create-edit-refine-store workflow.

## Scope

- Add missing artifact workflow settings through existing settings mechanisms.
- Complete i18n labels for route, mini-app, library editor, versioning, and settings copy.
- Remove hardcoded English from artifact settings surfaces.
- Add end-to-end smoke coverage instructions and targeted tests.
- Run final repository checks.

## Success Criteria

- No new user-visible artifact labels are hardcoded.
- Artifact workflow settings are available without unapproved state/schema changes.
- `pnpm lint`, `pnpm test`, and `pnpm format` complete successfully.
- `pnpm dev` smoke validates create -> edit -> refine -> store for HTML/HTMX and React, or failures are recorded with fixes.
