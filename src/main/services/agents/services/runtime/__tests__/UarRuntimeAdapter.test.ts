import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentStream, AgentStreamEvent } from '../../../interfaces/AgentStreamInterface'
import { UarRuntimeAdapter } from '../UarRuntimeAdapter'
import { universalAgentRuntimeService } from '../UniversalAgentRuntimeService'

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn(async () => ({
    valid: true,
    modelId: 'gpt-5.2',
    provider: {
      id: 'openai',
      type: 'openai',
      apiKey: 'test-key',
      apiHost: 'https://api.openai.com'
    }
  }))
}))

vi.mock('../UniversalAgentRuntimeService', () => ({
  universalAgentRuntimeService: {
    ensureRunning: vi.fn()
  }
}))

const fetchMock = vi.fn()

describe('UarRuntimeAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requires an endpoint for remote mode', async () => {
    const adapter = new UarRuntimeAdapter()
    const stream = await adapter.invoke('hello', createSession({ mode: 'remote' }), new AbortController())

    const events = await collectEvents(stream)

    expect(events.some((event) => event.type === 'error')).toBe(true)
    expect(events.find((event) => event.type === 'error')?.error?.message).toContain(
      'UAR remote runtime requires a configured endpoint'
    )
  })

  it('obtains an endpoint from the embedded sidecar service', async () => {
    vi.mocked(universalAgentRuntimeService.ensureRunning).mockResolvedValue('http://127.0.0.1:1906')
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(sseResponse('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n'))

    const adapter = new UarRuntimeAdapter()
    const stream = await adapter.invoke('hello', createSession({ mode: 'embedded' }), new AbortController())

    const events = await collectEvents(stream)

    expect(universalAgentRuntimeService.ensureRunning).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenLastCalledWith(
      new URL('/v1/chat/completions', 'http://127.0.0.1:1906'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"stream":true')
      })
    )
    expect(textDeltas(events)).toContain('hello')
    expect(events.at(-1)?.type).toBe('complete')
  })

  it('emits cancelled when aborted during execution', async () => {
    const abortController = new AbortController()
    abortController.abort()
    vi.mocked(universalAgentRuntimeService.ensureRunning).mockResolvedValue('http://127.0.0.1:1906')
    fetchMock.mockRejectedValue(new Error('aborted'))

    const adapter = new UarRuntimeAdapter()
    const stream = await adapter.invoke('hello', createSession({ mode: 'embedded' }), abortController)

    const events = await collectEvents(stream)

    expect(events.some((event) => event.type === 'cancelled')).toBe(true)
  })

  it('emits an error for non-2xx chat responses', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(new Response('failed', { status: 503 }))

    const adapter = new UarRuntimeAdapter()
    const stream = await adapter.invoke(
      'hello',
      createSession({ mode: 'remote', endpoint: 'http://127.0.0.1:1906' }),
      new AbortController()
    )

    const events = await collectEvents(stream)

    expect(events.find((event) => event.type === 'error')?.error?.message).toContain('status 503')
  })
})

function createSession(runtime: Record<string, unknown>): any {
  return {
    id: 'session-id',
    agent_id: 'agent-id',
    name: 'Test Session',
    model: 'openai:gpt-5.2',
    accessible_paths: ['/tmp/workspace'],
    configuration: {
      runtime: {
        kind: 'uar',
        ...runtime
      }
    }
  }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json'
    }
  })
}

function sseResponse(text: string): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text))
        controller.close()
      }
    }),
    {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'x-uar-session-id': 'uar-session-id'
      }
    }
  )
}

function collectEvents(stream: AgentStream): Promise<AgentStreamEvent[]> {
  return new Promise((resolve) => {
    const events: AgentStreamEvent[] = []
    stream.on('data', (event) => {
      events.push(event)
      if (event.type === 'complete' || event.type === 'error' || event.type === 'cancelled') {
        resolve(events)
      }
    })
  })
}

function textDeltas(events: AgentStreamEvent[]): string[] {
  return events
    .filter((event) => event.type === 'chunk' && event.chunk?.type === 'text-delta')
    .map((event) => (event.chunk as any).text)
}
