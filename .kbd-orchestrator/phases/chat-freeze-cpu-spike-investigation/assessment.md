# Assessment — Chat Freeze / CPU Spike Investigation

**Phase:** chat-freeze-cpu-spike-investigation
**Date:** 2026-05-30
**Author:** Claude Code (kbd-assess)
**Type:** Debugging investigation (root-cause hunt), not a feature build.

## Symptom (reported)

The chat for **both** assistants (home chat) and agents stops working after some
time; CPU utilization climbs and the application locks up.

## Primary Root-Cause Hypothesis (HIGH confidence)

**A leaked / self-multiplying `requestAnimationFrame` loop in
`src/renderer/src/hooks/useSmoothStream.ts`, driven by an unstable `onUpdate`
callback in `src/renderer/src/pages/home/Markdown/Markdown.tsx`.**

`useSmoothStream` is consumed by exactly one component — `Markdown.tsx` — but that
markdown renderer renders **every** assistant message and **every** agent message,
so the defect is shared by both chat surfaces (matches "happens in both").

### The mechanism (with evidence)

1. **Unstable `onUpdate` → `renderLoop` recreated every render.**
   `Markdown.tsx:64-68` passes `onUpdate` as an **inline arrow function**, so its
   identity changes on every render. `useSmoothStream`'s `renderLoop` is a
   `useCallback` depending on `onUpdate` (`useSmoothStream.ts:80`), so `renderLoop`
   is recreated on every render too.

2. **The startup effect re-runs every render and starts a new rAF each time.**
   `useSmoothStream.ts:83-93` is `useEffect(() => { animationFrameRef.current =
   requestAnimationFrame(renderLoop); return () => cancelAnimationFrame(
   animationFrameRef.current) }, [renderLoop])`. Because `renderLoop` changes every
   render, this effect re-runs every render: each run schedules a fresh rAF and
   stores its id in the single `animationFrameRef.current`.

3. **The single ref cannot track concurrent in-flight loops.**
   `renderLoop` itself reassigns `animationFrameRef.current` on every tick
   (`:47`, `:53`, `:77`). When the effect re-runs, its cleanup cancels only the
   *latest* id in the ref — but an already-scheduled frame from a **previous**
   `renderLoop` closure is still queued and will fire, then reschedule itself
   (`:47`/`:53`/`:77`), writing a new id the new effect's cleanup will never cancel.
   Result: **orphaned rAF loops accumulate** over the lifetime of a streaming
   message / a long session.

4. **Each orphaned loop busy-spins when the queue is empty but the stream is not
   done.** `useSmoothStream.ts:39-48`: if `chunkQueueRef` is empty and `streamDone`
   is false, it does no work and immediately `requestAnimationFrame(renderLoop)` —
   a ~60fps no-op spin. One such loop is cheap; N accumulated loops are not.

### Why this matches every observed symptom

- **"After some time" / "locks up":** orphaned loops accumulate as messages stream
  and components re-render; CPU rises gradually until the main thread saturates and
  the UI freezes.
- **CPU spike:** multiple concurrent rAF loops each spinning at display refresh,
  several calling `setDisplayedContent` (re-render) and re-running the effect →
  positive-feedback render storm.
- **Both assistants and agents:** `Markdown` renders all message content in both
  surfaces; the defect is in shared code.

### Isolation evidence

A scan of all renderer `requestAnimationFrame` call sites shows `useSmoothStream`
is the **only self-rescheduling rAF loop**; every other call site is a one-shot
`requestAnimationFrame(() => …)` (fires once, no recursion). `setInterval` usages
(4-hour update check `useAppInit.ts:107`; the managed `useTimer` hook) are not
freeze candidates. This isolates `useSmoothStream` as the primary suspect.

## Secondary / To-Rule-Out Candidates (LOWER confidence)

- **`Markdown.tsx` effect feedback (`:73-96`):** `onUpdate` → `setDisplayedContent`
  → re-render → new `onUpdate` → effect re-run. Even without the rAF leak, the
  unstable callback causes excessive re-render churn; it is the *driver* of the
  primary bug and should be addressed together.
- **Message list / virtualization effects** (`Messages.tsx`, `AgentSessionMessages.tsx`)
  — not yet read in depth; rule out as amplifiers once the primary fix is in.
- **RuntimeSettings 4s poll (added in change-023):** settings-only, gated on
  `document.visibilityState`, cleaned up on unmount — unlikely to affect chat; note
  for completeness, low priority.

## Verification Plan (before and after fix)

1. **Reproduce + measure:** open a chat, stream several long assistant messages
   (and an agent session), leave it for a while; capture CPU over time and a
   renderer performance/flame profile. Expect to see growing rAF callback frequency
   / many concurrent `renderLoop` frames.
2. **Confirm loop accumulation:** instrument (or breakpoint) `useSmoothStream`'s
   `requestAnimationFrame` scheduling to count concurrently-live loops; expect the
   count to grow per streamed message / re-render rather than stay at 1.
3. **Post-fix:** the live-loop count stays at exactly 1 per mounted streaming
   `Markdown`; CPU returns to baseline when no stream is progressing; a long
   multi-message session no longer climbs in CPU or freezes.

## Fix Direction (for the Plan phase — NOT implemented here)

The fix should guarantee **exactly one** rAF loop per mounted hook and stop the
empty-queue busy-spin. Likely elements:

- **Stabilize `onUpdate`** in `Markdown.tsx` (wrap in `useCallback` with stable
  deps, or read latest via a ref) so `renderLoop`/the effect stop being recreated
  every render.
- **Decouple `renderLoop` from React identity** — keep the loop function in a ref
  and read `streamDone`/`onUpdate`/`minDelay` from refs, so the startup effect runs
  **once** (empty or near-empty dep array) and owns a single loop.
- **Idempotent scheduling** — never schedule a new frame if one is already live;
  always cancel the tracked frame before scheduling; ensure cleanup truly stops the
  loop (guard with a "running" flag, not just a single id).
- **Stop spinning when idle** — when the queue is empty and the stream is not done,
  do not rAF-spin; resume the loop from `addChunk`/status-change instead (event-
  driven rather than poll-driven), or throttle to `minDelay` via `setTimeout`.

This is a small, well-contained hook refactor plus a one-line `Markdown.tsx`
callback stabilization. TDD-able: add a hook test asserting only one live rAF loop
and no scheduling when idle+!streamDone.

## Gaps / Open Items

- [ ] Confirm the hypothesis with a live profile (the investigation is static-analysis
      based; high confidence but not yet runtime-confirmed).
- [ ] Decide fix shape (ref-based single-loop refactor vs. minimal callback
      stabilization) in the Plan phase.
- [ ] Rule out the secondary message-list amplifiers once the primary fix lands.
- [ ] Add a regression test for single-loop invariant + idle-no-spin.

## Effort Estimate

**Low–medium.** Root cause is isolated to one shared hook (~96 lines) + one inline
callback. The risk is in getting the rAF lifecycle exactly right (TDD with fake
timers / rAF mock strongly advised, per the change-023 experience where async-
lifecycle races needed careful review).

## Recommended Next Step

`/kbd-plan chat-freeze-cpu-spike-investigation` to produce the ordered fix +
regression-test change list. Strongly recommend a runtime profile to confirm the
hypothesis before/while implementing.
