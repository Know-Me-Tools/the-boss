# Plan — Chat Freeze / CPU Spike Fix

**Phase:** chat-freeze-cpu-spike-investigation
**Date:** 2026-05-30
**Backend:** native KBD (OpenSpec not detected)
**Source assessment:** [assessment.md](./assessment.md)

## Objective

Eliminate the CPU-spike / UI-freeze that affects both assistants and agents chat,
caused by a leaked / self-multiplying `requestAnimationFrame` loop in
`useSmoothStream.ts` driven by an unstable `onUpdate` callback in `Markdown.tsx`.

## Strategy

TDD a contained hook refactor that guarantees **exactly one** rAF loop per mounted
hook and stops the idle busy-spin, plus stabilize the `Markdown.tsx` callback so the
loop is not recreated every render. Add a regression test that asserts the
single-loop / no-idle-spin invariants. Confirm with a runtime profile.

## Ordered Change List

| # | Change | Depends on | Risk |
|---|---|---|---|
| 1 | `fix-001-smoothstream-raf-leak` | — | medium (async lifecycle) |
| 2 | `fix-002-chat-freeze-verification` | fix-001 | low |

### fix-001 — Fix the leaked rAF loop (TDD)
Refactor `useSmoothStream` for a single-owner loop:
- Keep `streamDone`/`onUpdate`/`minDelay` in refs; the startup `useEffect` runs once
  (stable/empty deps) and owns one loop. `renderLoop` no longer a render-identity dep.
- Idempotent scheduling: never schedule if a frame is already live; a single
  "running" guard + always-cancel-before-schedule; cleanup truly stops the loop.
- Event-driven idle: when the queue is empty and the stream is not done, do NOT
  rAF-spin — resume from `addChunk` / a `streamDone` transition instead.
- Stabilize `Markdown.tsx` `onUpdate` (useCallback with stable deps or latest-ref)
  so the hook is not driven into recreation each render.
- Add `src/renderer/src/hooks/__tests__/useSmoothStream.test.ts` (fake timers + rAF
  mock): asserts (a) exactly one live loop across re-renders, (b) no scheduling when
  idle+!streamDone, (c) text still streams in order and flushes on streamDone,
  (d) cleanup cancels the loop on unmount, (e) reset cancels + restarts cleanly.

### fix-002 — Verification (runtime + regression)
- Build + run the app; reproduce the long-session streaming scenario for both
  assistants and an agent session; capture a renderer CPU/perf profile before/after
  to confirm orphaned-loop accumulation is gone and CPU returns to baseline.
- Run the new hook test + the streaming integration test
  (`store/thunk/__tests__/streamCallback.integration.test.ts`) + Markdown-related
  renderer tests; `pnpm run typecheck:web`; `git diff --check`.
- Document the before/after profile in the change file.

## Verification (phase)

- `pnpm vitest run --project renderer src/renderer/src/hooks/__tests__/useSmoothStream.test.ts`
- `pnpm vitest run --project renderer src/renderer/src/store/thunk/__tests__/streamCallback.integration.test.ts`
- `pnpm run typecheck:web`
- `git diff --check`
- Runtime: long multi-message stream (assistants + agents) shows flat CPU, no freeze.

## Definition of Done

- [ ] One rAF loop per mounted `useSmoothStream`, verified by test.
- [ ] No rAF scheduling when idle and stream not done.
- [ ] Streaming output still correct (order preserved, final flush on done).
- [ ] `Markdown.tsx` no longer recreates the loop every render.
- [ ] Runtime profile confirms CPU stays flat over a long session (no freeze).
- [ ] PR opened to `main`.

## Out of Scope

- The secondary message-list/virtualization amplifiers (rule out only if the
  primary fix doesn't fully resolve the runtime profile).
- The RuntimeSettings poll (settings-only, already gated).
