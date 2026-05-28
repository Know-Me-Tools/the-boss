# merge-004 — Verify build, tests, branding

**Phase:** upstream-1.9.x-merge-strategy
**Depends on:** merge-003
**Risk:** low

## Why

Confirm the merge is sound: build green, branding intact, fork-only features still load.

## Tasks

- [ ] `pnpm install` (reconcile lockfile + version bump 1.9.6 → 1.9.7).
  - If i18n sort issues: `pnpm i18n:sync`. If format issues: `pnpm format`.
- [ ] `pnpm build:check` (= `pnpm lint && pnpm test`) per CLAUDE.md.
- [ ] Confirm branding: `appId: tools.know-me.the-boss`, `productName: The Boss`.
- [ ] Confirm fork-only surface intact (dirs present, compile clean):
  `services/the-boss-control-plane/`, `src/main/services/agents/services/runtime/`,
  `vendor/{codex,opencode,universal-agent-runtime}`.
- [ ] Open PR via the `gh-create-pr` skill targeting `main`. **Do not** merge to `main`
      without explicit user approval.

## Verification

- `pnpm build:check` exits 0.
- Branding identifiers present in `electron-builder.yml`.
- PR created and linked.
