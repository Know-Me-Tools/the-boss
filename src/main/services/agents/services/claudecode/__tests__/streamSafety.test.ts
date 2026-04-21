import { describe, expect, it, vi } from 'vitest'

import { createOneShotUserMessageStream, createStreamWatchdog, destroyClaudeChildProcess } from '../streamSafety'

describe('Claude stream safety helpers', () => {
  it('closes a one-shot prompt stream after yielding the initial message', async () => {
    const abortController = new AbortController()
    const { stream } = createOneShotUserMessageStream('hello', abortController.signal)
    const iterator = stream[Symbol.asyncIterator]()

    const first = await iterator.next()
    expect(first.done).toBe(false)
    expect(first.value).toMatchObject({
      type: 'user',
      parent_tool_use_id: null,
      session_id: '',
      message: {
        role: 'user',
        content: 'hello'
      }
    })

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('aborts on first-byte timeout when no SDK messages arrive', () => {
    vi.useFakeTimers()
    try {
      const abortController = new AbortController()
      const onTimeout = vi.fn()
      const watchdog = createStreamWatchdog({
        abortController,
        firstByteTimeoutMs: 100,
        inactivityTimeoutMs: 1000,
        onTimeout
      })

      vi.advanceTimersByTime(100)

      expect(abortController.signal.aborted).toBe(true)
      expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({ phase: 'first-byte' }))
      watchdog.cleanup()
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts on inactivity timeout after SDK messages stop arriving', () => {
    vi.useFakeTimers()
    try {
      const abortController = new AbortController()
      const onTimeout = vi.fn()
      const watchdog = createStreamWatchdog({
        abortController,
        firstByteTimeoutMs: 100,
        inactivityTimeoutMs: 250,
        onTimeout
      })

      vi.advanceTimersByTime(50)
      watchdog.markMessageReceived()
      vi.advanceTimersByTime(249)
      expect(abortController.signal.aborted).toBe(false)

      vi.advanceTimersByTime(1)
      expect(abortController.signal.aborted).toBe(true)
      expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({ phase: 'inactivity' }))
      watchdog.cleanup()
    } finally {
      vi.useRealTimers()
    }
  })

  it('terminates a Claude child process with a SIGTERM to SIGKILL grace path', () => {
    vi.useFakeTimers()
    try {
      const kill = vi.fn()
      const removeAllListeners = vi.fn()
      const destroy = vi.fn()
      const child = {
        killed: false,
        exitCode: null,
        signalCode: null,
        kill,
        removeAllListeners,
        stdin: { destroy },
        stdout: { destroy },
        stderr: { destroy }
      }

      destroyClaudeChildProcess(child as any, 'test cleanup', 100)

      expect(kill).toHaveBeenCalledWith('SIGTERM')
      expect(destroy).toHaveBeenCalledTimes(3)
      expect(removeAllListeners).toHaveBeenCalled()

      vi.advanceTimersByTime(100)
      expect(kill).toHaveBeenCalledWith('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })
})
