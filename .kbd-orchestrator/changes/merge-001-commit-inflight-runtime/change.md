# merge-001 — Commit in-flight runtime work

**Phase:** upstream-1.9.x-merge-strategy
**Depends on:** none
**Risk:** low

## Why

The working tree is dirty with in-flight multi-runtime agent work (`change-019..024`
plus modified runtime services). A merge cannot start on a dirty tree. User elected
to **commit** (not stash) so the work is preserved in history.

## Tasks

- [ ] Review `git status` and `git diff --stat` to confirm scope is the runtime work.
- [ ] Stage runtime + orchestrator changes (`src/main/services/agents/services/runtime/*`,
      `scripts/publish-runtime-artifacts-ipfs.js`, `src/main/index.ts`, settings UI,
      `.kbd-orchestrator/changes/change-019..024`, docs).
- [ ] Commit with `git commit --signoff -m "feat(runtime): checkpoint in-flight multi-runtime work before upstream merge"`.
- [ ] Confirm `git status` is clean.

## Verification

- `git status` reports a clean working tree (nothing to commit).
