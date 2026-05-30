import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSmoothStream } from '../useSmoothStream'

/**
 * Deterministic requestAnimationFrame harness.
 *
 * We track every scheduled-but-not-yet-cancelled frame callback. `liveCount`
 * therefore reflects how many independent rAF loops are currently in flight.
 * The original (buggy) implementation re-schedules a fresh loop on every render
 * via a `[renderLoop]` effect, so `liveCount` would climb above 1; the fixed
 * implementation must keep it at no more than 1.
 */
interface FakeRaf {
  flushOneFrame: (time: number) => void
  liveCount: () => number
  scheduledTotal: () => number
  cleanup: () => void
}

const installFakeRaf = (): FakeRaf => {
  const pending = new Map<number, FrameRequestCallback>()
  let nextId = 1
  let scheduledTotal = 0

  const raf = vi.fn((cb: FrameRequestCallback): number => {
    const id = nextId++
    pending.set(id, cb)
    scheduledTotal++
    return id
  })

  const caf = vi.fn((id: number): void => {
    pending.delete(id)
  })

  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', caf)

  return {
    // Run every callback that is currently pending exactly once. Callbacks may
    // re-schedule themselves; those new frames are NOT run within the same
    // flush (they wait for the next flush), mirroring real rAF semantics.
    flushOneFrame: (time: number) => {
      const snapshot = Array.from(pending.entries())
      for (const [id, cb] of snapshot) {
        pending.delete(id)
        cb(time)
      }
    },
    liveCount: () => pending.size,
    scheduledTotal: () => scheduledTotal,
    cleanup: () => {
      pending.clear()
      vi.unstubAllGlobals()
    }
  }
}

describe('useSmoothStream', () => {
  let fakeRaf: FakeRaf

  beforeEach(() => {
    fakeRaf = installFakeRaf()
  })

  afterEach(() => {
    fakeRaf.cleanup()
    vi.restoreAllMocks()
  })

  it('keeps at most one live rAF loop across re-renders with changing onUpdate identity', () => {
    let time = 0
    const advance = () => {
      time += 1000
      act(() => fakeRaf.flushOneFrame(time))
    }

    // Each render passes a brand-new inline onUpdate (identity churn) — the
    // exact pattern Markdown.tsx uses.
    const { result, rerender } = renderHook(
      ({ done }: { done: boolean }) =>
        useSmoothStream({
          onUpdate: () => {
            /* new identity every render */
          },
          streamDone: done,
          initialText: ''
        }),
      { initialProps: { done: false } }
    )

    // Keep a loop actively in flight (non-empty queue) so the loop is
    // continuously re-scheduling itself while we force re-renders. This is the
    // condition under which the buggy `[renderLoop]` startup effect orphans
    // frames: its cleanup cancels a stale id while the in-flight loop has
    // already advanced the tracked id.
    act(() => result.current.addChunk('a'.repeat(200)))

    for (let i = 0; i < 8; i++) {
      rerender({ done: false })
      expect(fakeRaf.liveCount()).toBeLessThanOrEqual(1)
      advance()
      expect(fakeRaf.liveCount()).toBeLessThanOrEqual(1)
      // Keep feeding so the loop never drains to idle during the churn.
      act(() => result.current.addChunk('b'.repeat(50)))
    }
  })

  it('does not busy-spin when idle and resumes when a chunk arrives', () => {
    let time = 0
    const advance = () => {
      time += 1000
      act(() => fakeRaf.flushOneFrame(time))
    }

    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, initialText: '' }))

    // Settle the initial loop: empty queue + not done -> must stop scheduling.
    advance()
    advance()

    expect(fakeRaf.liveCount()).toBe(0)
    const totalBefore = fakeRaf.scheduledTotal()

    // No work => no further frames scheduled.
    advance()
    expect(fakeRaf.scheduledTotal()).toBe(totalBefore)

    // A new chunk must resume the loop.
    act(() => result.current.addChunk('hello'))
    expect(fakeRaf.liveCount()).toBe(1)

    // Drain the queue.
    for (let i = 0; i < 20 && fakeRaf.liveCount() > 0; i++) {
      advance()
    }
    expect(onUpdate).toHaveBeenCalled()
    const lastCall = onUpdate.mock.calls.at(-1)
    expect(lastCall?.[0]).toBe('hello')
  })

  it('streams text in order and flushes the remaining queue when streamDone flips true', () => {
    let time = 0
    const advance = () => {
      time += 1000
      act(() => fakeRaf.flushOneFrame(time))
    }

    const onUpdate = vi.fn()
    const { result, rerender } = renderHook(
      ({ done }: { done: boolean }) => useSmoothStream({ onUpdate, streamDone: done, initialText: '' }),
      { initialProps: { done: false } }
    )

    advance() // settle idle

    act(() => result.current.addChunk('hello world'))

    // Drain partially over multiple frames.
    advance()
    advance()

    // Outputs so far must be prefixes of the full text, in growing order.
    const partials = onUpdate.mock.calls.map((c) => c[0] as string)
    for (const p of partials) {
      expect('hello world'.startsWith(p)).toBe(true)
    }

    // Flip streamDone -> remaining queue flushed in one go.
    rerender({ done: true })
    // Adding nothing; the streamDone transition should resume + flush.
    for (let i = 0; i < 20 && fakeRaf.liveCount() > 0; i++) {
      advance()
    }

    expect(onUpdate.mock.calls.at(-1)?.[0]).toBe('hello world')
  })

  it('cancels the live loop on unmount with no leaked frame', () => {
    let time = 0
    const onUpdate = vi.fn()
    const { result, unmount } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, initialText: '' }))

    act(() => result.current.addChunk('abcdef'))
    expect(fakeRaf.liveCount()).toBe(1)

    unmount()
    expect(fakeRaf.liveCount()).toBe(0)

    // Flushing after unmount must not re-schedule anything.
    const totalBefore = fakeRaf.scheduledTotal()
    time += 1000
    act(() => fakeRaf.flushOneFrame(time))
    expect(fakeRaf.scheduledTotal()).toBe(totalBefore)
    expect(fakeRaf.liveCount()).toBe(0)
  })

  it('reset cancels the loop, clears the queue, emits new text, and accepts new chunks', () => {
    let time = 0
    const advance = () => {
      time += 1000
      act(() => fakeRaf.flushOneFrame(time))
    }

    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, initialText: '' }))

    act(() => result.current.addChunk('oldoldold'))
    advance()

    onUpdate.mockClear()
    act(() => result.current.reset('fresh'))

    // reset emits the new text immediately.
    expect(onUpdate).toHaveBeenCalledWith('fresh')

    // Queue cleared: a flush should not emit leftover old chars.
    onUpdate.mockClear()
    advance()
    for (const c of onUpdate.mock.calls) {
      expect(c[0]).not.toContain('old')
    }

    // A subsequent addChunk still works (loop resumes, builds on 'fresh').
    onUpdate.mockClear()
    act(() => result.current.addChunk('XY'))
    for (let i = 0; i < 20 && fakeRaf.liveCount() > 0; i++) {
      advance()
    }
    expect(onUpdate.mock.calls.at(-1)?.[0]).toBe('freshXY')
  })
})
