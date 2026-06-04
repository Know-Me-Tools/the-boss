# Current KBD Waypoint

**Project:** The Boss / Cherry Studio fork
**Active phase:** `artifact-editor-iterative-design-protocol`
**Status:** reflection complete
**Branch:** `feat/artifact-productization-skill-system`
**Backend for latest kbd-plan:** OpenSpec detected from root `openspec/`
**Date:** 2026-06-04

## What This Phase Adds

The v1 artifact designer foundation is complete, but the full product workflow
still needs durable stored-artifact source updates, library-to-designer editing,
assistant and agent conversation entry points, first-class navigation/mini-app
access, Prometheus skill-system availability, settings/i18n completion, and
end-to-end verification.

## Ordered Changes

1. ✅ `artifact-008-storage-version-update` - persist source edits and append artifact versions.
2. ✅ `artifact-009-library-designer-entry` - open stored artifacts in `ArtifactDesigner` and save refinements.
3. ✅ `artifact-010-conversation-entrypoints` - verify and wire assistant plus agent conversation Edit with AI entries.
4. ✅ `artifact-011-navigation-and-miniapp` - add first-class artifact library route, sidebar entry, and mini-app surface.
5. ✅ `artifact-012-prometheus-skill-sync` - normalize Prometheus skill-system references and runtime availability.
6. ✅ `artifact-013-settings-i18n-verification` - complete artifact settings, labels, and end-to-end verification.

## Exact Next Command

```sh
/kbd-new-phase
```

Advance to the next KBD phase. Run `/kbd-status` first if you want to inspect
the completed artifact-editor phase.

## Key Constraints

- Stay on the current 1.9.x codebase.
- Do not use `v2`.
- Do not add Redux slices or change database schemas without explicit user approval.
- Keep all user-visible labels in i18next.
- Run `pnpm lint`, `pnpm test`, and `pnpm format` before implementation completion.
