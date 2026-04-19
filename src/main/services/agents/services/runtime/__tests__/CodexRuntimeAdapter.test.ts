import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentStream, AgentStreamEvent } from '../../../interfaces/AgentStreamInterface'
import { CodexRuntimeAdapter } from '../CodexRuntimeAdapter'
import type { RuntimeContextBundle } from '../RuntimeContextBundle'

const modelValidation = vi.hoisted(() => ({
  result: {
    valid: true,
    modelId: 'gpt-5.2-codex',
    provider: {
      id: 'openai',
      type: 'openai',
      apiKey: 'test-key',
      apiHost: 'https://api.openai.com'
    }
  }
}))

const codexMock = vi.hoisted(() => {
  const state = {
    constructorOptions: [] as any[],
    threads: [] as Array<{ mode: 'start' | 'resume'; id?: string; options: any }>,
    runs: [] as Array<{ input: unknown; turnOptions: any }>,
    events: [] as any[]
  }

  const createThread = (id?: string) => ({
    async runStreamed(input: unknown, turnOptions: any) {
      state.runs.push({ input, turnOptions })
      return {
        events: (async function* () {
          for (const event of state.events) {
            yield event
          }
        })()
      }
    },
    id: id ?? null
  })

  const Codex = vi.fn(function (this: unknown, options?: unknown) {
    state.constructorOptions.push(options)
    return {
      startThread: vi.fn((threadOptions) => {
        state.threads.push({ mode: 'start', options: threadOptions })
        return createThread()
      }),
      resumeThread: vi.fn((id, threadOptions) => {
        state.threads.push({ mode: 'resume', id, options: threadOptions })
        return createThread(id)
      })
    }
  })

  return {
    Codex,
    state
  }
})

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn(async () => modelValidation.result)
}))

vi.mock('@openai/codex-sdk', () => ({
  Codex: codexMock.Codex
}))

describe('CodexRuntimeAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelValidation.result = {
      valid: true,
      modelId: 'gpt-5.2-codex',
      provider: {
        id: 'openai',
        type: 'openai',
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com'
      }
    }
    codexMock.state.constructorOptions = []
    codexMock.state.threads = []
    codexMock.state.runs = []
    codexMock.state.events = [
      { type: 'thread.started', thread_id: 'thread-new' },
      { type: 'turn.started' },
      {
        type: 'item.completed',
        item: {
          id: 'cmd-1',
          type: 'command_execution',
          command: 'pnpm test',
          aggregated_output: 'ok',
          status: 'completed',
          exit_code: 0
        }
      },
      {
        type: 'item.completed',
        item: {
          id: 'msg-1',
          type: 'agent_message',
          text: 'done'
        }
      },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 10,
          cached_input_tokens: 2,
          output_tokens: 4
        }
      }
    ]
  })

  it('maps canonical runtime config into Codex client and thread options', async () => {
    const abortController = new AbortController()
    const adapter = new CodexRuntimeAdapter()
    const stream = await adapter.invoke(
      createBundle('User prompt'),
      createSession({
        instructions: 'Custom instructions',
        accessible_paths: ['/tmp/workspace', '/tmp/second'],
        runtime: {
          endpoint: 'https://openai-proxy.example/v1',
          sandbox: {
            mode: 'read-only',
            networkAccess: true
          },
          permissions: {
            mode: 'never'
          },
          mcp: {
            servers: {
              git: {
                command: 'git-mcp'
              }
            }
          },
          reasoningEffort: 'xhigh'
        }
      }),
      abortController,
      undefined,
      { effort: 'high' }
    )

    const events = await collectEvents(stream)

    expect(codexMock.state.constructorOptions[0]).toEqual(
      expect.objectContaining({
        apiKey: 'test-key',
        baseUrl: 'https://openai-proxy.example/v1',
        env: {
          OPENAI_API_KEY: 'test-key'
        },
        config: {
          mcp_servers: {
            git: {
              command: 'git-mcp'
            }
          }
        }
      })
    )
    expect(codexMock.state.threads[0]).toEqual({
      mode: 'start',
      options: expect.objectContaining({
        model: 'gpt-5.2-codex',
        workingDirectory: '/tmp/workspace',
        additionalDirectories: ['/tmp/second'],
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        networkAccessEnabled: true,
        modelReasoningEffort: 'xhigh',
        skipGitRepoCheck: true
      })
    })
    expect(codexMock.state.runs[0].input).toContain('Custom instructions')
    expect(codexMock.state.runs[0].input).toContain('User prompt')
    expect(codexMock.state.runs[0].turnOptions.signal).toBe(abortController.signal)
    expect(stream.sdkSessionId).toBe('thread-new')
    expect(chunkTypes(events)).toEqual(
      expect.arrayContaining(['data-agent-runtime-status', 'data-agent-runtime-tool', 'data-agent-runtime-usage'])
    )
    expect(textDeltas(events)).toEqual(['done'])
  })

  it('resumes an existing Codex thread id', async () => {
    const adapter = new CodexRuntimeAdapter()
    const stream = await adapter.invoke('Continue', createSession(), new AbortController(), 'thread-existing')

    await collectEvents(stream)

    expect(codexMock.state.threads[0]).toEqual({
      mode: 'resume',
      id: 'thread-existing',
      options: expect.objectContaining({
        model: 'gpt-5.2-codex',
        workingDirectory: '/tmp/workspace'
      })
    })
  })

  it('rejects invalid sandbox or approval settings before starting Codex', async () => {
    const adapter = new CodexRuntimeAdapter()
    const stream = await adapter.invoke(
      'hello',
      createSession({
        runtime: {
          sandbox: {
            mode: 'invalid'
          }
        }
      }),
      new AbortController()
    )

    const events = await collectEvents(stream)

    expect(events.find((event) => event.type === 'error')?.error?.message).toContain('Unsupported Codex sandbox mode')
    expect(codexMock.Codex).not.toHaveBeenCalled()
  })

  it('rejects non-OpenAI providers before starting Codex', async () => {
    modelValidation.result = {
      valid: true,
      modelId: 'claude-sonnet',
      provider: {
        id: 'anthropic',
        type: 'anthropic',
        apiKey: 'anthropic-key',
        apiHost: 'https://api.anthropic.com'
      }
    } as any

    const adapter = new CodexRuntimeAdapter()
    const stream = await adapter.invoke('hello', createSession(), new AbortController())

    const events = await collectEvents(stream)

    expect(events.find((event) => event.type === 'error')?.error?.message).toContain(
      "Provider type 'anthropic' is not supported by the Codex runtime"
    )
    expect(codexMock.Codex).not.toHaveBeenCalled()
  })
})

function createSession(overrides: Record<string, any> = {}): any {
  const runtime = overrides.runtime ?? {}
  return {
    id: 'session-id',
    agent_id: 'agent-id',
    name: 'Test Session',
    instructions: overrides.instructions,
    model: 'openai:gpt-5.2-codex',
    accessible_paths: overrides.accessible_paths ?? ['/tmp/workspace'],
    mcps: ['git'],
    configuration: {
      runtime: {
        kind: 'codex',
        modelId: 'openai:gpt-5.2-codex',
        ...runtime
      }
    }
  }
}

function createBundle(prompt: string): RuntimeContextBundle {
  return {
    type: 'prepared-agent-turn',
    prompt,
    originalPrompt: prompt,
    session: {
      id: 'session-id',
      agentId: 'agent-id',
      name: 'Test Session'
    },
    runtime: {
      config: {
        kind: 'codex',
        mode: 'managed'
      },
      compatibility: {
        kind: 'codex',
        compatible: true,
        capabilities: {} as any,
        warnings: [],
        blockingIssues: []
      }
    },
    model: {
      id: 'openai:gpt-5.2-codex'
    },
    workspace: {
      cwd: '/tmp/workspace',
      accessiblePaths: ['/tmp/workspace']
    },
    context: {
      skills: [],
      knowledgeReferences: []
    },
    attachments: {
      images: []
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
