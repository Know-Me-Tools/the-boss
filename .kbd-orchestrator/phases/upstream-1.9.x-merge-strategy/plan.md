# Plan — Upstream 1.9.x Merge Strategy

**Phase:** upstream-1.9.x-merge-strategy
**Date:** 2026-05-28
**Backend:** native KBD (OpenSpec not detected)
**Source assessment:** [assessment.md](./assessment.md)

## Objective

Integrate upstream `CherryHQ/cherry-studio` **v1.9.7** (11 commits, 19 files, 2 real
conflicts) into the fork via a **direct merge**, preserving all fork-only capabilities
(control plane, multi-runtime agents, vendored runtimes) and **The Boss** branding.

## Strategy (decided in assessment §7)

Direct `git merge upstream/main` — not rebase, not cherry-pick. Merge-base
`b1d63a3bb` is already established from the prior integration commit.

## Ordered Change List

| # | Change | Depends on | Agent | Risk |
|---|---|---|---|---|
| 1 | `merge-001-commit-inflight-runtime` | — | claude-code | low |
| 2 | `merge-002-create-merge-branch` | merge-001 | claude-code | low |
| 3 | `merge-003-merge-and-resolve-conflicts` | merge-002 | claude-code | low |
| 4 | `merge-004-verify-build-and-branding` | merge-003 | claude-code | low |

### merge-001 — Commit in-flight runtime work
Tree is dirty with `change-019..024` runtime work + modified runtime services.
Commit on `main` with a conventional message so the merge starts on a clean tree
and the work is preserved in history. **User chose: commit (not stash).**

### merge-002 — Create merge branch
Branch `merge/upstream-v1.9.7` off `main`. Per CLAUDE.md, never use `v2`.

### merge-003 — Merge upstream/main and resolve the 2 conflicts
- `git merge upstream/main`
- `electron-builder.yml`: keep `appId: tools.know-me.the-boss`, `productName: The Boss`;
  combine the `releaseInfo` changelog (keep branded entry, fold in upstream notes).
- `src/renderer/src/utils/analytics.ts`: take upstream `trackTokenUsage` signature
  (`source = 'chat'`) + `enableDataCollection` guard; re-apply fork call sites if needed.
- Review the 7 auto-merged collision files (`ConfigManager`, `OpenClawService` +test,
  `claudecode/utils`, `aiCore/utils/options`, `analytics.test`, `package.json`).

### merge-004 — Verify build, tests, branding
- `pnpm install` (lockfile + version bump 1.9.6 → 1.9.7 reconciliation).
- `pnpm lint && pnpm test && pnpm build:check` (per CLAUDE.md).
- Confirm branding intact (`appId`, `productName: The Boss`).
- Confirm fork-only features load (control plane, agent runtime).
- Open PR via `gh-create-pr` skill (do not merge to `main` without approval).

## Out of Scope

- Rebranding `package.json` `name: CherryStudio` (identical on both sides; no conflict).
- Any `v2` work (prohibited per CLAUDE.md).
- New features on the deprecated/blocked DATA&UI refactor files.

## Definition of Done

- [ ] Working tree committed (merge-001)
- [ ] `merge/upstream-v1.9.7` branch created (merge-002)
- [ ] `upstream/main` merged, 2 conflicts resolved, 7 auto-merges verified (merge-003)
- [ ] `pnpm build:check` green; branding + fork features confirmed (merge-004)
- [ ] PR opened for review
