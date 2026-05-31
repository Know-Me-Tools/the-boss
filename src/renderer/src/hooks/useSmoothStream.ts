import { useCallback, useEffect, useRef } from 'react'

interface UseSmoothStreamOptions {
  onUpdate: (text: string) => void
  streamDone: boolean
  minDelay?: number
  initialText?: string
}

const languages = ['en-US', 'de-DE', 'es-ES', 'zh-CN', 'zh-TW', 'ja-JP', 'ru-RU', 'el-GR', 'fr-FR', 'pt-PT', 'ro-RO']
const segmenter = new Intl.Segmenter(languages)

const DEFAULT_MIN_DELAY = 10

/**
 * Smoothly reveals a streaming text by paced character batches.
 *
 * Design notes (see fix-001):
 * - The render loop is owned by a single startup effect with stable deps so it
 *   is created ONCE on mount and torn down ONCE on unmount. Per-render values
 *   (`onUpdate`, `streamDone`, `minDelay`) are read through refs that a tiny
 *   sync effect keeps current, so changing those props never recreates the loop.
 * - Exactly one rAF loop can be live at a time. `runningRef` guards scheduling
 *   and we always cancel the tracked frame id before scheduling a new one.
 * - No idle busy-spin: when the queue is empty and the stream is not done, the
 *   loop stops scheduling. `addChunk` and a `streamDone -> true` transition
 *   resume it. This keeps CPU at zero when there is no work.
 */
export const useSmoothStream = ({
  onUpdate,
  streamDone,
  minDelay = DEFAULT_MIN_DELAY,
  initialText = ''
}: UseSmoothStreamOptions) => {
  const chunkQueueRef = useRef<string[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const displayedTextRef = useRef<string>(initialText)
  const lastUpdateTimeRef = useRef<number>(0)
  const runningRef = useRef<boolean>(false)

  // Latest-value refs so the loop reads current props without being recreated.
  const onUpdateRef = useRef(onUpdate)
  const streamDoneRef = useRef(streamDone)
  const minDelayRef = useRef(minDelay)

  const renderLoop = useCallback((currentTime: number) => {
    // We are executing this frame; it is no longer pending.
    animationFrameRef.current = null

    const isStreamDone = streamDoneRef.current
    const onUpdateCurrent = onUpdateRef.current
    const minDelayCurrent = minDelayRef.current

    // 1. Empty queue.
    if (chunkQueueRef.current.length === 0) {
      if (isStreamDone) {
        // Final flush: ensure the latest full text is emitted, then stop.
        onUpdateCurrent(displayedTextRef.current)
      }
      // Either done (flushed) or idle with no work: stop the loop. No spin.
      runningRef.current = false
      return
    }

    // 2. Pace updates by minDelay; reschedule without doing work yet.
    if (currentTime - lastUpdateTimeRef.current < minDelayCurrent) {
      animationFrameRef.current = requestAnimationFrame(renderLoop)
      return
    }
    lastUpdateTimeRef.current = currentTime

    // 3. Dynamic chars-per-frame; flush everything once the stream is done.
    let charsToRenderCount = Math.max(1, Math.floor(chunkQueueRef.current.length / 5))
    if (isStreamDone) {
      charsToRenderCount = chunkQueueRef.current.length
    }

    const charsToRender = chunkQueueRef.current.slice(0, charsToRenderCount)
    displayedTextRef.current += charsToRender.join('')

    // 4. Update UI immediately.
    onUpdateCurrent(displayedTextRef.current)

    // 5. Advance the queue.
    chunkQueueRef.current = chunkQueueRef.current.slice(charsToRenderCount)

    // 6. Continue if there is more work; otherwise stop (no idle spin).
    if (chunkQueueRef.current.length > 0) {
      animationFrameRef.current = requestAnimationFrame(renderLoop)
    } else {
      runningRef.current = false
    }
  }, [])

  // Schedule the loop if it is not already live. Idempotent + single-owner.
  const scheduleLoop = useCallback(() => {
    if (runningRef.current) {
      return
    }
    runningRef.current = true
    // Cancel any stale tracked frame before scheduling a fresh one.
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
    }
    animationFrameRef.current = requestAnimationFrame(renderLoop)
  }, [renderLoop])

  // Stop the loop and clear any tracked frame.
  const stopLoop = useCallback(() => {
    runningRef.current = false
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [])

  // Keep latest-value refs current and resume on a streamDone false -> true edge.
  useEffect(() => {
    onUpdateRef.current = onUpdate
    minDelayRef.current = minDelay
    const wasDone = streamDoneRef.current
    streamDoneRef.current = streamDone
    if (!wasDone && streamDone) {
      scheduleLoop()
    }
  }, [onUpdate, streamDone, minDelay, scheduleLoop])

  const addChunk = useCallback(
    (chunk: string) => {
      const chars = Array.from(segmenter.segment(chunk)).map((s) => s.segment)
      chunkQueueRef.current = [...chunkQueueRef.current, ...(chars || [])]
      // Resume the loop if it had gone idle.
      scheduleLoop()
    },
    [scheduleLoop]
  )

  const reset = useCallback(
    (newText = '') => {
      stopLoop()
      chunkQueueRef.current = []
      displayedTextRef.current = newText
      lastUpdateTimeRef.current = 0
      onUpdateRef.current(newText)
    },
    [stopLoop]
  )

  // Own the loop lifecycle: start once on mount, fully stop once on unmount.
  useEffect(() => {
    scheduleLoop()
    return () => {
      stopLoop()
    }
  }, [scheduleLoop, stopLoop])

  return { addChunk, reset }
}
