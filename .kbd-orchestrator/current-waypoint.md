# Current KBD Waypoint

Project: The Boss / Cherry Studio fork
Phase: upstream-1.9.x-merge-strategy
Date: 2026-05-28
Status: planning_complete

## Objective

Integrate upstream CherryHQ/cherry-studio **v1.9.7** into the fork via a **direct
merge**, preserving fork-only capabilities (control plane, multi-runtime agents,
vendored runtimes) and **The Boss** branding.

## Divergence (from assessment)

- Merge-base `b1d63a3bb`; fork +126 commits, upstream +11 (the v1.9.7 release).
- 19 upstream files changed; **2 real conflicts** in a trial merge.
- Fork-only surface and branding are untouched by upstream — zero risk.

## Ordered Changes

1. `merge-001-commit-inflight-runtime` — commit dirty runtime work (clean tree)
2. `merge-002-create-merge-branch` — branch `merge/upstream-v1.9.7` off `main`
3. `merge-003-merge-and-resolve-conflicts` — merge + resolve 2 conflicts
   (`electron-builder.yml` branding, `analytics.ts` enableDataCollection)
4. `merge-004-verify-build-and-branding` — `pnpm build:check`, confirm branding, open PR

## Next Step

Execute **merge-001**: `git status && git diff --stat`, then commit the in-flight
runtime work on `main`. Per CLAUDE.md, never use `v2`.

## Suspended Phase

`multi-runtime-agent-parity-assessment` (execution_in_progress, next change
`change-022`) is paused until this merge lands. Its in-flight work is committed by
merge-001; resume afterward.
