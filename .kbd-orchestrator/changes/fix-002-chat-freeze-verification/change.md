# fix-002 — Verify chat-freeze fix (runtime profile + regression)

**Phase:** chat-freeze-cpu-spike-investigation
**Depends on:** fix-001-smoothstream-raf-leak
**Risk:** low

## Why

Confirm the fix-001 hook refactor actually resolves the runtime freeze (the
hypothesis was static-analysis based) and guard against regression.

## Tasks

- [ ] Build + run the app; reproduce a long streaming session in BOTH the
  assistants home chat and an agent session (several long messages over time).
- [ ] Capture a renderer CPU / performance profile; confirm: rAF callback frequency
  no longer grows, no orphaned-loop accumulation, CPU returns to baseline when no
  stream is progressing, and the app does not freeze.
- [ ] Run the regression suite:
  - `pnpm vitest run --project renderer src/renderer/src/hooks/__tests__/useSmoothStream.test.ts`
  - `pnpm vitest run --project renderer src/renderer/src/store/thunk/__tests__/streamCallback.integration.test.ts`
  - any Markdown-related renderer tests
  - `pnpm run typecheck:web`
- [ ] Record before/after profile summary here.

## Acceptance Criteria

- [ ] Runtime profile shows flat CPU over a long session; no freeze in either surface.
- [ ] All regression tests pass; typecheck green.

## Verification

- Runtime profile (manual / interactive — may require user assist to reproduce).
- Test + typecheck commands above.
- `git diff --check`

## Note

The runtime-profile capture may be partly interactive (reproducing the long-session
freeze). If it cannot be fully automated in this environment, document the test +
typecheck evidence here and flag the runtime confirmation as a user-assisted step.
