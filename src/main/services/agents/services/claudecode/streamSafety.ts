import type { SDKUserMessage, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'

type UserInputContent = string | ContentBlockParam[]

export type ClaudeStreamTimeoutPhase = 'first-byte' | 'inactivity'

export type ClaudeStreamTimeout = {
  phase: ClaudeStreamTimeoutPhase
  timeoutMs: number
}

export type ClaudeStreamWatchdog = {
  markMessageReceived: () => void
  cleanup: () => void
}

export type ClaudeChildProcess = Partial<SpawnedProcess> & {
  killed?: boolean
  exitCode?: number | null
  signalCode?: string | null
  kill?: (signal: NodeJS.Signals) => boolean
  removeAllListeners?: () => unknown
  stdin?: { destroy?: () => unknown }
  stdout?: { destroy?: () => unknown }
  stderr?: { destroy?: () => unknown }
}

export function createOneShotUserMessageStream(initialContent: UserInputContent, abortSignal: AbortSignal) {
  let closed = false

  const close = () => {
    closed = true
  }

  const stream = (async function* (): AsyncGenerator<SDKUserMessage> {
    if (abortSignal.aborted || closed) {
      return
    }

    try {
      yield {
        type: 'user',
        parent_tool_use_id: null,
        session_id: '',
        message: {
          role: 'user',
          content: initialContent
        }
      }
    } finally {
      close()
    }
  })()

  return {
    stream,
    close
  }
}

export function createStreamWatchdog(options: {
  abortController: AbortController
  firstByteTimeoutMs: number
  inactivityTimeoutMs: number
  onTimeout: (timeout: ClaudeStreamTimeout) => void
}): ClaudeStreamWatchdog {
  const { abortController, firstByteTimeoutMs, inactivityTimeoutMs, onTimeout } = options
  let timeout: NodeJS.Timeout | undefined
  let cleanedUp = false

  const clearCurrentTimer = () => {
    if (timeout) {
      clearTimeout(timeout)
      timeout = undefined
    }
  }

  const arm = (phase: ClaudeStreamTimeoutPhase, timeoutMs: number) => {
    clearCurrentTimer()
    if (cleanedUp || abortController.signal.aborted || timeoutMs <= 0) {
      return
    }
    timeout = setTimeout(() => {
      if (cleanedUp || abortController.signal.aborted) {
        return
      }
      onTimeout({ phase, timeoutMs })
      abortController.abort(new Error(`Claude SDK stream ${phase} timeout after ${timeoutMs}ms`))
    }, timeoutMs)
  }

  arm('first-byte', firstByteTimeoutMs)

  return {
    markMessageReceived: () => {
      if (cleanedUp || abortController.signal.aborted) {
        return
      }
      arm('inactivity', inactivityTimeoutMs)
    },
    cleanup: () => {
      cleanedUp = true
      clearCurrentTimer()
    }
  }
}

export function destroyClaudeChildProcess(
  child: ClaudeChildProcess | undefined,
  _reason: string,
  killGraceMs = 2000
): void {
  if (!child) {
    return
  }

  const isExited = child.exitCode !== null && child.exitCode !== undefined
  const alreadyKilled = child.killed || child.signalCode || isExited

  child.stdin?.destroy?.()
  child.stdout?.destroy?.()
  child.stderr?.destroy?.()
  child.removeAllListeners?.()

  if (!alreadyKilled) {
    child.kill?.('SIGTERM')
    setTimeout(() => {
      const exitedAfterTerm = child.exitCode !== null && child.exitCode !== undefined
      if (!child.killed && !child.signalCode && !exitedAfterTerm) {
        child.kill?.('SIGKILL')
      }
    }, killGraceMs).unref?.()
  }
}
