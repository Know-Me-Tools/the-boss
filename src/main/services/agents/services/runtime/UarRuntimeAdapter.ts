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

          await emitModelCatalogEvent(stream, endpoint, authHeaders, abortController.signal)

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
            signal: abortController.signal
          })

          if (!response.ok) {
            throw new Error(`UAR runtime request failed with status ${response.status}`)
          }

          stream.sdkSessionId = response.headers.get('x-uar-session-id') ?? lastAgentSessionId
          await consumeUarResponse(response, stream)
          stream.emitComplete()
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

async function consumeUarResponse(response: Response, stream: RuntimeAgentStream): Promise<void> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream') && response.body) {
    await consumeSseResponse(response, stream)
    return
  }

  const payload = await response.json()
  emitTextBlock(stream, extractUarText(payload))
  emitUarPayload(stream, payload)
}

async function consumeSseResponse(response: Response, stream: RuntimeAgentStream): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

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
