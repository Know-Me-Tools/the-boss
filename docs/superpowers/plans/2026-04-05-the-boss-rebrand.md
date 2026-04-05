# The Boss Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the app to `The Boss`, move it onto its own install/runtime identity, and update user-facing links and copy without renaming upstream-sensitive package/import/provider identifiers.

**Architecture:** Add a small brand/config layer for app identity and public URLs, then route packaging/runtime surfaces through it. After runtime identity is isolated, sweep user-facing strings, locale assets, docs, and tests while leaving compatibility-sensitive code symbols unchanged.

**Tech Stack:** Electron, electron-builder, React, i18next locale JSON, TypeScript, Vitest, Playwright fixtures

---

### Task 1: Add Central Brand Configuration

**Files:**
- Create: `packages/shared/config/branding.ts`
- Modify: `packages/shared/config/constant.ts`
- Modify: `src/renderer/src/config/env.ts`
- Modify: `src/main/index.ts`

- [ ] Define canonical app identity and public URLs in a shared branding module.
- [ ] Re-export any needed constants to existing consumers with minimal disruption.
- [ ] Set runtime app identity from the new branding values during main-process startup.

### Task 2: Separate Runtime and Install Identity

**Files:**
- Modify: `electron-builder.yml`
- Modify: `src/main/config.ts`
- Modify: `src/main/services/agents/drizzle.config.ts`
- Modify: `src/main/utils/init.ts`
- Modify: `src/main/utils/file.ts`
- Modify: `src/main/services/AppService.ts`
- Modify: `src/main/services/ProtocolClient.ts`
- Modify: `src/main/services/SelectionService.ts`

- [ ] Switch app ID, product name, executable/desktop names, protocol display metadata, and updater publish target to The Boss.
- [ ] Move dev and packaged storage containers to The Boss-specific locations.
- [ ] Update temp/autostart/protocol desktop/runtime filenames that expose the app identity.

### Task 3: Rebrand Main and Renderer UI Surfaces

**Files:**
- Modify: `src/main/services/AppMenuService.ts`
- Modify: `src/main/services/TrayService.ts`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/selectionAction.html`
- Modify: `src/renderer/src/pages/settings/AboutSettings.tsx`
- Modify: `src/main/services/MCPService.ts`
- Modify: `resources/builtin-agents/cherry-assistant/agent.json`

- [ ] Replace visible app naming in menus, tray text, titles, About page, built-in assistant copy, and runtime labels.
- [ ] Re-point user-facing website/docs/issues/releases links to The Boss destinations.

### Task 4: Sweep Locales, Static Assets, and Repo Docs

**Files:**
- Modify: `src/renderer/src/i18n/locales/*.json`
- Modify: `src/renderer/src/i18n/translate/*.json`
- Modify: `resources/cherry-studio/*.html`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `SECURITY.md`
- Modify: relevant package metadata/docs files that expose repo branding

- [ ] Replace user-facing references to The Boss with The Boss in locale and bundled HTML content.
- [ ] Replace repo-facing links and descriptions with The Boss equivalents.
- [ ] Keep compatibility-sensitive scopes/imports/provider IDs untouched.

### Task 5: Update Tests and Verify

**Files:**
- Modify: tests asserting old titles/names/paths as needed
- Test: `pnpm lint`
- Test: `pnpm test`
- Test: `pnpm format`

- [ ] Update assertions that still expect `The Boss` or old storage/install names.
- [ ] Run the required verification commands and fix regressions.
