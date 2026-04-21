import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentStream, AgentStreamEvent } from '../../../interfaces/AgentStreamInterface'
import * as openCodeRuntimeModule from '../OpenCodeRuntimeAdapter'

const validateModelIdMock = vi.hoisted(() => vi.fn())

const openCodeServiceMock = vi.hoisted(() => {
  const state = {
    resolveClientCalls: [] as any[],
    clients: [] as any[],
    clientsByKey: new Map<string, any>(),
    closes: 0,
    sessionCounter: 0,
    promptResponse: undefined as any,
    events: [] as any[]
  }

  const createClient = (kind: 'managed' | 'remote') => {
    const client = {
      kind,
      config: {
        update: vi.fn(async (options) => ({ data: options.body }))
      },
      event: {
        subscribe: vi.fn(async () => ({
          stream: (async function* () {
            for (const event of state.events) {
              yield event
            }
          })()
        }))
      },
      session: {
        create: vi.fn(async () => {
          state.sessionCounter += 1
          return { data: { id: `opencode-session-${state.sessionCounter}` } }
        }),
        prompt: vi.fn(async () => state.promptResponse ?? defaultPromptResponse())
      },
      postSessionIdPermissionsPermissionId: vi.fn(async () => ({ data: true }))
    }
    state.clients.push(client)
    return client
  }

  const resolveClient = vi.fn(async (runtimeConfig, cwd, config) => {
    state.resolveClientCalls.push({ runtimeConfig, cwd, config })
    if (runtimeConfig.mode === 'remote' && !runtimeConfig.endpoint) {
      throw new Error('OpenCode remote runtime requires a configured endpoint')
    }
    const key =
      runtimeConfig.mode === 'remote' ? `remote:${runtimeConfig.endpoint}` : `${cwd}:${JSON.stringify(config)}`
    if (!state.clientsByKey.has(key)) {
      state.clientsByKey.set(key, createClient(runtimeConfig.mode === 'remote' ? 'remote' : 'managed'))
    }
    return state.clientsByKey.get(key)
  })

  const dispose = vi.fn(async () => {
    state.closes += state.clientsByKey.size
    state.clientsByKey.clear()
  })

  return {
    resolveClient,
    dispose,
    state
  }
})

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: validateModelIdMock
}))

vi.mock('../OpenCodeCliService', () => ({
  openCodeCliService: {
    resolveClient: openCodeServiceMock.resolveClient,
    dispose: openCodeServiceMock.dispose
  }
}))

vi.mock('electron', () => ({
  app: {
    once: vi.fn()
  }
}))

describe('OpenCodeRuntimeAdapter', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await (openCodeRuntimeModule as any).disposeOpenCodeManagedServers?.()
    openCodeServiceMock.state.resolveClientCalls = []
    openCodeServiceMock.state.clients = []
    openCodeServiceMock.state.clientsByKey.clear()
    openCodeServiceMock.state.closes = 0
    openCodeServiceMock.state.sessionCounter = 0
    openCodeServiceMock.state.promptResponse = undefined
    openCodeServiceMock.state.events = []
  })

  it('reuses a managed OpenCode server across resumed turns', async () => {
    const adapter = new openCodeRuntimeModule.OpenCodeRuntimeAdapter()

    const firstStream = await adapter.invoke('first', createSession(), new AbortController())
    await collectEvents(firstStream)
    const secondStream = await adapter.invoke(
      'second',
      createSession(),
      new AbortController(),
      firstStream.sdkSessionId
    )
    await collectEvents(secondStream)

    expect(openCodeServiceMock.resolveClient).toHaveBeenCalledTimes(2)
    expect(openCodeServiceMock.state.clients).toHaveLength(1)
    expect(openCodeServiceMock.state.closes).toBe(0)
    expect(openCodeServiceMock.state.clients[0].session.create).toHaveBeenCalledTimes(1)
    expect(openCodeServiceMock.state.clients[0].session.prompt).toHaveBeenCalledTimes(2)
    expect(openCodeServiceMock.state.clients[0].session.prompt.mock.calls[1][0].path.id).toBe(firstStream.sdkSessionId)
    expect(validateModelIdMock).not.toHaveBeenCalled()
  })

  it('maps remote endpoint, auth, model, permissions, tools, and MCP into OpenCode config', async () => {
    const adapter = new openCodeRuntimeModule.OpenCodeRuntimeAdapter()
    const stream = await adapter.invoke(
      'remote prompt',
      createSession({
        instructions: 'Use the project conventions.',
        allowed_tools: ['bash', 'edit'],
        runtime: {
          mode: 'remote',
          endpoint: 'http://127.0.0.1:4097',
          authRef: 'remote-token',
          agentName: 'builder',
          permissions: {
            mode: 'allow'
          },
          mcp: {
            servers: {
              git: {
                type: 'local',
                command: ['git-mcp']
              }
            }
          }
        }
      }),
      new AbortController()
    )

    await collectEvents(stream)

    expect(openCodeServiceMock.resolveClient).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'remote',
        endpoint: 'http://127.0.0.1:4097',
        authRef: 'remote-token'
      }),
      '/tmp/workspace',
      expect.objectContaining({
        model: 'openai/gpt-5.2'
      })
    )
    expect(openCodeServiceMock.state.clients[0].config.update).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { directory: '/tmp/workspace' },
        body: expect.objectContaining({
          model: 'openai/gpt-5.2',
          mcp: {
            git: {
              type: 'local',
              command: ['git-mcp']
            }
          },
          agent: {
            builder: expect.objectContaining({
              model: 'openai/gpt-5.2',
              prompt: 'Use the project conventions.',
              tools: {
                bash: true,
                edit: true
              },
              permission: {
                bash: 'allow',
                edit: 'allow',
                webfetch: 'allow',
                doom_loop: 'allow',
                external_directory: 'allow'
              }
            })
          }
        })
      })
    )
    expect(openCodeServiceMock.state.clients[0].session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent: 'builder',
          system: 'Use the project conventions.',
          model: {
            providerID: 'openai',
            modelID: 'gpt-5.2'
          },
          tools: {
            bash: true,
            edit: true
          }
        })
      })
    )
  })

  it('normalizes response parts and permission events into runtime chunks', async () => {
    openCodeServiceMock.state.promptResponse = {
      data: {
        info: { id: 'assistant-message' },
        parts: [
          { id: 'text-1', type: 'text', text: 'hello' },
          {
            id: 'tool-1',
            type: 'tool',
            tool: 'bash',
            state: {
              status: 'completed',
              output: 'ok'
            }
          },
          {
            id: 'finish-1',
            type: 'step-finish',
            reason: 'stop',
            cost: 0.01,
            tokens: {
              input: 11,
              output: 7,
              reasoning: 3,
              cache: {
                read: 2,
                write: 1
              }
            }
          }
        ]
      }
    }
    openCodeServiceMock.state.events = [
      {
        type: 'permission.updated',
        properties: {
          id: 'permission-1',
          sessionID: 'opencode-session-1',
          title: 'Run shell command',
          metadata: {}
        }
      }
    ]

    const adapter = new openCodeRuntimeModule.OpenCodeRuntimeAdapter()
    const stream = await adapter.invoke('hello', createSession(), new AbortController())
    const events = await collectEvents(stream)

    expect(textDeltas(events)).toEqual(['hello'])
    expect(chunkTypes(events)).toEqual(
      expect.arrayContaining([
        'data-agent-runtime-status',
        'data-agent-runtime-permission',
        'data-agent-runtime-tool',
        'data-agent-runtime-usage'
      ])
    )
  })

  it('rejects remote mode without an endpoint before starting a managed server', async () => {
    const adapter = new openCodeRuntimeModule.OpenCodeRuntimeAdapter()
    const stream = await adapter.invoke(
      'hello',
      createSession({
        runtime: {
          mode: 'remote'
        }
      }),
      new AbortController()
    )

    const events = await collectEvents(stream)

    expect(events.find((event) => event.type === 'error')?.error?.message).toContain(
      'OpenCode remote runtime requires a configured endpoint'
    )
    expect(openCodeServiceMock.resolveClient).toHaveBeenCalledTimes(1)
  })
})

function defaultPromptResponse(): any {
  return {
    data: {
      info: { id: 'assistant-message' },
      parts: [{ id: 'text-1', type: 'text', text: 'ok' }]
    }
  }
}

function createSession(overrides: Record<string, any> = {}): any {
  const runtime = overrides.runtime ?? {}
  return {
    id: 'session-id',
    agent_id: 'agent-id',
    name: 'Test Session',
    instructions: overrides.instructions,
    model: 'openai/gpt-5.2',
    accessible_paths: overrides.accessible_paths ?? ['/tmp/workspace'],
    allowed_tools: overrides.allowed_tools ?? [],
    configuration: {
      runtime: {
        kind: 'opencode',
        modelId: 'openai/gpt-5.2',
        ...runtime
      }
    }
  }
}

function collectEvents(stream: AgentStream): Promise<AgentStreamEvent[]> {
  return new Promise((resolve, reject) => {
    const events: AgentStreamEvent[] = []
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for stream terminal event after ${events.length} events`))
    }, 1000)
    stream.on('data', (event) => {
      events.push(event)
      if (event.type === 'complete' || event.type === 'error' || event.type === 'cancelled') {
        clearTimeout(timeout)
        resolve(events)
      }
    })
  })
}

function chunkTypes(events: AgentStreamEvent[]): string[] {
  return events
    .filter((event) => event.type === 'chunk' && typeof event.chunk?.type === 'string')
    .map((event) => event.chunk?.type as string)
}

function textDeltas(events: AgentStreamEvent[]): string[] {
  return events
    .filter((event) => event.type === 'chunk' && event.chunk?.type === 'text-delta')
    .map((event) => (event.chunk as any).text)
}
