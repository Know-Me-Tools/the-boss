export type StreamAbortHandler = (reason: unknown) => void

export interface StreamAbortController {
  abortController: AbortController
  registerAbortHandler: (handler: StreamAbortHandler) => void
  clearAbortTimeout: () => void
  resetAbortTimeout: () => void
  dispose: () => void
}

export const STREAM_TIMEOUT_REASON = 'stream timeout'

interface CreateStreamAbortControllerOptions {
  timeoutMs: number
}

export const createStreamAbortController = (options: CreateStreamAbortControllerOptions): StreamAbortController => {
  const { timeoutMs } = options
  const abortController = new AbortController()
  const signal = abortController.signal

  let timeoutId: NodeJS.Timeout | undefined
  let abortHandler: StreamAbortHandler | undefined

  const clearAbortTimeout = () => {
    if (!timeoutId) {
      return
    }
    clearTimeout(timeoutId)
    timeoutId = undefined
  }

  const resetAbortTimeout = () => {
    clearAbortTimeout()
    if (timeoutMs > 0 && !signal.aborted) {
      timeoutId = setTimeout(() => {
        if (!signal.aborted) {
          abortController.abort(STREAM_TIMEOUT_REASON)
        }
      }, timeoutMs)
    }
  }

  const handleAbort = () => {
    clearAbortTimeout()

    if (!abortHandler) {
      return
    }

    abortHandler(signal.reason)
  }

  signal.addEventListener('abort', handleAbort, { once: true })

  let disposed = false

  const dispose = () => {
    if (disposed) return
    disposed = true
    clearAbortTimeout()
    signal.removeEventListener('abort', handleAbort)
  }

  const registerAbortHandler = (handler: StreamAbortHandler) => {
    abortHandler = handler

    if (signal.aborted) {
      abortHandler(signal.reason)
    }
  }

  resetAbortTimeout()

  return {
    abortController,
    registerAbortHandler,
    clearAbortTimeout,
    resetAbortTimeout,
    dispose
  }
}
