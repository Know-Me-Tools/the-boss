# fix-001 — Fix leaked requestAnimationFrame loop in useSmoothStream

**Phase:** chat-freeze-cpu-spike-investigation
**Depends on:** none
**Risk:** medium (async rAF lifecycle — TDD with fake timers/rAF mock)

## Why

Chat freezes with CPU at 100% in BOTH assistants and agents after some time. Root
cause (assessment.md): `useSmoothStream` recreates its `renderLoop` every render
(because `Markdown.tsx` passes an inline `onUpdate`), the startup effect re-runs
every render and starts a new rAF, and a single ref can't track the concurrent
in-flight loops — so orphaned self-rescheduling rAF loops accumulate and busy-spin
when idle. `Markdown` renders every assistant + agent message, so both surfaces hit it.

## Tasks

- [ ] Add `src/renderer/src/hooks/__tests__/useSmoothStream.test.ts` (FIRST, RED):
  - exactly one live rAF loop across multiple re-renders (mock rAF/cancelRAF, assert
    net live-loop count stays 1)
  - no new rAF scheduled when queue empty AND streamDone is false (no idle spin)
  - streamed text appears in order; final flush on streamDone
  - cleanup cancels the loop on unmount
  - `reset()` cancels and restarts cleanly
- [ ] Refactor `src/renderer/src/hooks/useSmoothStream.ts`:
  - store `streamDone`/`onUpdate`/`minDelay` in refs; startup effect runs once
    (stable deps); single loop owner; idempotent scheduling (running guard +
    cancel-before-schedule); event-driven resume from `addChunk`/streamDone instead
    of idle rAF spin.
- [ ] Stabilize `onUpdate` in `src/renderer/src/pages/home/Markdown/Markdown.tsx`
  (useCallback with stable deps or latest-ref) so the hook isn't recreated per render.
- [ ] Run tests → GREEN; `pnpm run typecheck:web` exit 0.

## Acceptance Criteria

- [ ] Only one rAF loop per mounted hook (test-proven).
- [ ] No rAF scheduling when idle and stream not done.
- [ ] Streaming output unchanged (order + final flush).
- [ ] Markdown.tsx no longer drives loop recreation each render.

## Verification

- `pnpm vitest run --project renderer src/renderer/src/hooks/__tests__/useSmoothStream.test.ts`
- `pnpm vitest run --project renderer src/renderer/src/store/thunk/__tests__/streamCallback.integration.test.ts`
- `pnpm run typecheck:web`
- `git diff --check`
