import { validateModelId } from '@main/apiServer/utils'
import type { GetAgentSessionResponse } from '@types'
import type { TextStreamPart } from 'ai'

import type { AgentServiceInterface, AgentStream } from '../../interfaces/AgentStreamInterface'
import { emitTextBlock, enqueueRuntimeError, RuntimeAgentStream } from './RuntimeAgentStream'
import { type AgentTurnInput, getPromptText } from './RuntimeContextBundle'
import { type AgentRuntimeCapabilities, DEFAULT_RUNTIME_CAPABILITIES, resolveRuntimeConfig } from './types'
import { universalAgentRuntimeService } from './UniversalAgentRuntimeService'

export class UarRuntimeAdapter implements AgentServiceInterface {
  readonly capabilities: AgentRuntimeCapabilities = {
    ...DEFAULT_RUNTIME_CAPABILITIES,
    tools: true,
    mcp: true,
    fileAccess: true,
    shellAccess: true
  }

  async invoke(
    prompt: AgentTurnInput,
    session: GetAgentSessionResponse,
    abortController: AbortController,
    lastAgentSessionId?: string
  ): Promise<AgentStream> {
    const promptText = getPromptText(prompt)
    const runtimeConfig = resolveRuntimeConfig(session)
    const modelInfo = await validateModelId(session.configuration?.runtime?.modelId ?? session.model)
    if (!modelInfo.valid || !modelInfo.provider) {
      return enqueueRuntimeError(
        new Error(`Invalid UAR model ID '${session.model}': ${JSON.stringify(modelInfo.error)}`)
      )
    }
    const provider = modelInfo.provider
    if (provider.type === 'vertexai' || provider.type === 'vertex-anthropic') {
      return enqueueRuntimeError(
        new Error(
          'provider_unsupported: UAR does not support Vertex AI providers yet. Select Claude runtime for Vertex Anthropic models or use a direct OpenAI-compatible provider.'
        )
      )
    }

    const stream = new RuntimeAgentStream()

    queueMicrotask(() => {
      void (async () => {
        try {
          const endpoint = await resolveUarEndpoint(runtimeConfig, {
            providerId: provider.id,
            apiKey: provider.apiKey,
            apiHost: provider.apiHost,
            modelId: modelInfo.modelId
          })
          const authHeaders: Record<string, string> = runtimeConfig.authRef
            ? { authorization: `Bearer ${runtimeConfig.authRef}` }
            : {}
          const watchdog = createUarRequestWatchdog(abortController.signal)

          try {
            await emitModelCatalogEvent(stream, endpoint, authHeaders, watchdog.signal)

            const response = await fetch(new URL('/v1/chat/completions', endpoint), {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...authHeaders,
                ...(lastAgentSessionId ? { 'x-uar-session-id': lastAgentSessionId } : {})
              },
              body: JSON.stringify({
                model: modelInfo.modelId,
                messages: [
                  {
                    role: 'user',
                    content: promptText
                  }
                ],
                stream: true,
                stream_mode: 'openai'
              }),
              signal: watchdog.signal
            })
            watchdog.markFirstByte()

            if (!response.ok) {
              throw new Error(`UAR runtime request failed with status ${response.status}`)
            }

            stream.sdkSessionId = response.headers.get('x-uar-session-id') ?? lastAgentSessionId
            await consumeUarResponse(response, stream, watchdog.resetActivity)
            stream.emitComplete()
          } finally {
            watchdog.dispose()
          }
        } catch (error) {
          if (abortController.signal.aborted) {
            stream.emit('data', { type: 'cancelled' })
            return
          }
          stream.emitError(error instanceof Error ? error : new Error(String(error)))
        }
      })()
    })

    return stream
  }
}

async function resolveUarEndpoint(
  runtimeConfig: ReturnType<typeof resolveRuntimeConfig>,
  providerOptions: {
    providerId?: string
    apiKey?: string
    apiHost?: string
    modelId?: string
  }
): Promise<string> {
  if (runtimeConfig.mode === 'remote' || runtimeConfig.endpoint) {
    if (!runtimeConfig.endpoint) {
      throw new Error('UAR remote runtime requires a configured endpoint before execution.')
    }
    return runtimeConfig.endpoint
  }

  return universalAgentRuntimeService.ensureRunning(runtimeConfig, providerOptions)
}

async function emitModelCatalogEvent(
  stream: RuntimeAgentStream,
  endpoint: string,
  authHeaders: Record<string, string>,
  signal: AbortSignal
): Promise<void> {
  try {
    const response = await fetch(new URL('/v1/models', endpoint), {
      headers: authHeaders,
      signal
    })
    if (!response.ok) return

    const payload = await response.json()
    stream.emitChunk({
      type: 'data-agent-runtime-event',
      data: {
        runtime: 'uar',
        event: 'models',
        payload
      }
    } as unknown as TextStreamPart<Record<string, any>>)
  } catch {
    // Model discovery is opportunistic; chat execution remains the source of truth.
  }
}

async function consumeUarResponse(
  response: Response,
  stream: RuntimeAgentStream,
  resetActivity: () => void
): Promise<void> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream') && response.body) {
    await consumeSseResponse(response, stream, resetActivity)
    return
  }

  resetActivity()
  const payload = await response.json()
  emitTextBlock(stream, extractUarText(payload))
  emitUarPayload(stream, payload)
}

async function consumeSseResponse(
  response: Response,
  stream: RuntimeAgentStream,
  resetActivity: () => void
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    resetActivity()
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() ?? ''

    for (const event of events) {
      processSseEvent(event, stream)
    }
  }

  if (buffer.trim()) {
    processSseEvent(buffer, stream)
  }
}

function createUarRequestWatchdog(parentSignal: AbortSignal): {
  signal: AbortSignal
  markFirstByte: () => void
  resetActivity: () => void
  dispose: () => void
} {
  const controller = new AbortController()
  const timeouts = new Set<NodeJS.Timeout>()
  let idleTimeout: NodeJS.Timeout | undefined
  let waitingForFirstByte = true
  let parentAbortListener: (() => void) | undefined

  const abort = (reason: Error) => {
    if (!controller.signal.aborted) {
      controller.abort(reason)
    }
  }
  const setTrackedTimeout = (callback: () => void, ms: number) => {
    const timeout = setTimeout(() => {
      timeouts.delete(timeout)
      callback()
    }, ms)
    timeouts.add(timeout)
    return timeout
  }
  const clearTrackedTimeout = (timeout: NodeJS.Timeout | undefined) => {
    if (!timeout) return
    clearTimeout(timeout)
    timeouts.delete(timeout)
  }

  if (parentSignal.aborted) {
    abort(parentSignal.reason instanceof Error ? parentSignal.reason : new Error('UAR request cancelled.'))
  } else {
    parentAbortListener = () =>
      abort(parentSignal.reason instanceof Error ? parentSignal.reason : new Error('UAR request cancelled.'))
    parentSignal.addEventListener('abort', parentAbortListener, { once: true })
  }

  const firstByteTimeout = setTrackedTimeout(() => {
    if (waitingForFirstByte) {
      abort(new Error('first_byte_timeout: UAR did not send response headers within 30 seconds.'))
    }
  }, 30_000)

  setTrackedTimeout(() => abort(new Error('request_timeout: UAR request exceeded 10 minutes.')), 10 * 60_000)

  const resetActivity = () => {
    if (controller.signal.aborted) return
    clearTrackedTimeout(idleTimeout)
    idleTimeout = setTrackedTimeout(() => abort(new Error('idle_timeout: UAR stream was idle for 30 seconds.')), 30_000)
  }

  return {
    signal: controller.signal,
    markFirstByte: () => {
      waitingForFirstByte = false
      clearTrackedTimeout(firstByteTimeout)
      resetActivity()
    },
    resetActivity,
    dispose: () => {
      for (const timeout of timeouts) {
        clearTimeout(timeout)
      }
      timeouts.clear()
      if (parentAbortListener) {
        parentSignal.removeEventListener('abort', parentAbortListener)
      }
    }
  }
}

function processSseEvent(rawEvent: string, stream: RuntimeAgentStream): void {
  const dataLines = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())

  if (!dataLines.length) return

  const data = dataLines.join('\n')
  if (data === '[DONE]') return

  try {
    const payload = JSON.parse(data)
    emitTextBlock(stream, extractUarText(payload))
    emitUarPayload(stream, payload)
  } catch {
    emitTextBlock(stream, data)
  }
}

function extractUarText(payload: any): string {
  return String(
    payload?.choices?.[0]?.delta?.content ??
      payload?.choices?.[0]?.message?.content ??
      payload?.message?.content ??
      payload?.content ??
      ''
  )
}

function emitUarPayload(stream: RuntimeAgentStream, payload: unknown): void {
  stream.emitChunk({
    type: 'data-agent-runtime-event',
    data: {
      runtime: 'uar',
      payload
    }
  } as unknown as TextStreamPart<Record<string, any>>)
}
