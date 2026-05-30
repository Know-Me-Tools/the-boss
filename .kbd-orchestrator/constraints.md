# KBD Constraints — The Boss / Cherry Studio fork

Project-wide constraints the artifact-refiner QA gate validates each change against.
Derived from `CLAUDE.md` / `AGENTS.md`.

## Upstream / branch

- Build on the current **1.9.x** upstream codebase. **Never** use the `v2` branch or
  codebase for upstream work.
- Keep changes minimal, focused, and compatible with the 1.9.x base.

## Code

- Route ALL logging through `loggerService` (`@logger`). No `console.log`.
- All user-visible strings via i18next; no hardcoded UI strings. `pnpm i18n:check` clean.
- TypeScript strict; explicit types on exported/public APIs; avoid `any` (use `unknown`
  + narrow). Validate external/boundary input with Zod.
- Immutable updates (spread); no in-place mutation.
- Files focused (<800 lines); functions small (<50 lines); no deep nesting (>4).
- Biome formatting (2-space, single quotes, trailing commas); import order via
  simple-import-sort.

## Blocked without explicit user approval

- New Redux slices or changes to existing Redux state shape.
- Dexie (IndexedDB) schema changes.
- Feature changes to files bearing the `DATA&UI REFACTORING` freeze header
  (`@deprecated ... STOP: Feature PRs ... BLOCKED`) — **bug fixes only**.

## Security

- No Node APIs exposed directly to renderer; use `contextBridge` in preload.
- Validate all IPC inputs in main-process handlers.
- No hardcoded secrets.

## Testing / completion

- TDD: failing test first. Features without tests are NOT complete.
- Per-change gate: `pnpm lint && pnpm test` (+ `pnpm format`) green.
- Renderer tests jsdom (`tests/renderer.setup.ts`, @testing-library/react);
  main tests Node; aiCore separate config.

## Git

- Conventional Commits; sign commits (`git commit --signoff`).
- PRs via the `gh-create-pr` skill (fills `.github/pull_request_template.md`).
