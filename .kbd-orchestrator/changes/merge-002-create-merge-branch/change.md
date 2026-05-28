# merge-002 — Create merge branch

**Phase:** upstream-1.9.x-merge-strategy
**Depends on:** merge-001
**Risk:** low

## Why

Isolate the merge on a dedicated branch off `main`. Per CLAUDE.md, upstream work must
stay on the 1.9.x codebase — **never** `v2`.

## Tasks

- [ ] Confirm current branch is `main` and tree is clean.
- [ ] `git switch -c merge/upstream-v1.9.7`.
- [ ] Confirm `git rev-parse --abbrev-ref HEAD` == `merge/upstream-v1.9.7`.

## Verification

- On branch `merge/upstream-v1.9.7`, clean tree, no `v2` involvement.
