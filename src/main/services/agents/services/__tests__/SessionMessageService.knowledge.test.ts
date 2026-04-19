import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  buildSkillStreamPartsMock,
  invokeMock,
  loadInstalledSkillSelectionResourcesMock,
  persistExchangeMock,
  reduxSelectMock,
  resolveEffectiveRuntimeConfigMock,
  resolveScopedSkillConfigMock,
  runtimeBindingGetMock,
  runtimeBindingUpsertMock,
  searchMock,
  rerankMock
} = vi.hoisted(() => ({
  buildSkillStreamPartsMock: vi.fn().mockResolvedValue([]),
  invokeMock: vi.fn(),
  loadInstalledSkillSelectionResourcesMock: vi.fn().mockResolvedValue({
    skills: [],
    registry: { getAll: () => [] }
  }),
  persistExchangeMock: vi.fn().mockResolvedValue({}),
  reduxSelectMock: vi.fn(),
  resolveEffectiveRuntimeConfigMock: vi.fn(
    async (session) => session.configuration?.runtime ?? { kind: 'claude', mode: 'managed' }
  ),
  resolveScopedSkillConfigMock: vi.fn().mockResolvedValue({
    enabled: false,
    maxSkillTokens: 1000,
    contextManagementMethod: 'truncate',
    selectionMethod: 'hybrid'
  }),
  runtimeBindingGetMock: vi.fn().mockResolvedValue(''),
  runtimeBindingUpsertMock: vi.fn().mockResolvedValue({}),
  searchMock: vi.fn(),
  rerankMock: vi.fn()
}))

vi.mock('@main/aiCore/provider/providerConfig', () => ({
  formatProviderApiHost: vi.fn(async (provider) => provider)
}))

vi.mock('@main/services/ReduxService', () => ({
  reduxService: {
    select: reduxSelectMock
  }
}))

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => null)
  }
}))

vi.mock('@main/services/ConfigManager', () => ({
  ConfigKeys: {},
  configManager: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/tmp/cherry-studio-test'),
    getPath: vi.fn(() => '/tmp/cherry-studio-test-user-data'),
    once: vi.fn()
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn()
  },
  net: {
    fetch: vi.fn()
  }
}))

vi.mock('@main/services/skills/buildSkillStreamParts', () => ({
  buildSkillStreamParts: buildSkillStreamPartsMock
}))

vi.mock('@main/services/skills/installedSkillDescriptors', () => ({
  loadInstalledSkillSelectionResources: loadInstalledSkillSelectionResourcesMock
}))

vi.mock('@main/services/agents/skills/SkillScopeService', () => ({
  skillScopeService: {
    resolveConfig: resolveScopedSkillConfigMock
  }
}))

vi.mock('@main/utils/builtinSkills', () => ({
  installBuiltinSkills: vi.fn(async () => undefined)
}))

vi.mock('../../skills/SkillRepository', () => ({
  SkillRepository: {
    getInstance: vi.fn(() => ({
      list: vi.fn(async () => [])
    }))
  }
}))

vi.mock('../../skills/SkillService', () => ({
  skillService: {
    enableForAllAgents: vi.fn(async () => undefined),
    reconcileAgentSkills: vi.fn(async () => undefined)
  }
}))

vi.mock('../runtime/AgentRuntimeRouter', () => ({
  AgentRuntimeRouter: class MockAgentRuntimeRouter {
    invoke = invokeMock
    compact = vi.fn(async () => null)
  }
}))

vi.mock('../runtime/RuntimeControlService', () => ({
  runtimeControlService: {
    resolveEffectiveRuntimeConfig: resolveEffectiveRuntimeConfigMock
  }
}))

vi.mock('../runtime/RuntimeSessionBindingRepository', () => ({
  runtimeSessionBindingRepository: {
    getRuntimeSessionId: runtimeBindingGetMock,
    upsertBinding: runtimeBindingUpsertMock
  }
}))

vi.mock('../../database/sessionMessageRepository', () => ({
  agentMessageRepository: {
    persistExchange: persistExchangeMock
  }
}))

vi.mock('@main/services/KnowledgeService', () => ({
  default: {
    search: searchMock,
    rerank: rerankMock
  }
}))

vi.mock('../claudecode', () => ({
  default: class MockClaudeCodeService {
    invoke = invokeMock
  }
}))

import { sessionMessageService } from '../SessionMessageService'
import { sessionService } from '../SessionService'

const mockKnowledgeBase = {
  id: 'kb-1',
  name: 'Product Docs',
  model: {
    id: 'text-embedding-3-small',
    provider: 'openai',
    name: 'text-embedding-3-small',
    group: 'embedding'
  },
  items: [],
  created_at: 1,
  updated_at: 1,
  version: 1,
  documentCount: 2
}

const runtimeConfigs = {
  'kb-1': {
    embedApiClient: {
      apiKey: 'key',
      baseURL: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      provider: 'openai'
    }
  }
}

const baseSession = {
  id: 'session-1',
  agent_id: 'agent-1',
  agent_type: 'claude-code',
  name: 'Session',
  description: '',
  instructions: 'Use docs when needed',
  accessible_paths: ['/tmp'],
  allowed_tools: [],
  model: 'anthropic:claude-sonnet-4',
  configuration: {},
  created_at: '2026-04-07T00:00:00.000Z',
  updated_at: '2026-04-07T00:00:00.000Z'
}

function createClaudeStream() {
  const stream = new EventEmitter() as EventEmitter & { sdkSessionId?: string }
  stream.sdkSessionId = 'sdk-session-1'
  return stream
}

async function readAllParts(stream: ReadableStream<any>) {
  const reader = stream.getReader()
  const parts: any[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    parts.push(value)
  }

  return parts
}

describe('SessionMessageService knowledge retrieval', () => {
  beforeEach(() => {
    buildSkillStreamPartsMock.mockResolvedValue([])
    runtimeBindingGetMock.mockResolvedValue('')
    runtimeBindingUpsertMock.mockResolvedValue({})
    resolveEffectiveRuntimeConfigMock.mockImplementation(
      async (session) => session.configuration?.runtime ?? { kind: 'claude', mode: 'managed' }
    )
    resolveScopedSkillConfigMock.mockReset()
    resolveScopedSkillConfigMock.mockResolvedValue({
      enabled: false,
      maxSkillTokens: 1000,
      contextManagementMethod: 'truncate',
      selectionMethod: 'hybrid'
    })
    reduxSelectMock.mockReset()
    vi.spyOn(sessionService, 'ensureLastTotalTokensInMemory').mockResolvedValue(undefined)
    searchMock.mockResolvedValue([
      {
        pageContent: 'Knowledge base answer',
        metadata: { source: 'docs.md', type: 'file' },
        score: 0.9
      }
    ])
    rerankMock.mockImplementation(async (_event, params) => params.results)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    invokeMock.mockReset()
    buildSkillStreamPartsMock.mockClear()
    persistExchangeMock.mockClear()
    runtimeBindingGetMock.mockReset()
    runtimeBindingUpsertMock.mockReset()
    resolveEffectiveRuntimeConfigMock.mockReset()
    searchMock.mockReset()
    rerankMock.mockReset()
  })

  it('falls back to agent default knowledge, augments the prompt, emits citation events, and persists citation blocks', async () => {
    vi.spyOn(sessionMessageService as any, 'getLastAgentSessionId').mockResolvedValue('')
    vi.spyOn(sessionMessageService as any, 'getPersistedSession').mockResolvedValue({
      ...baseSession,
      knowledge_bases: undefined,
      knowledgeRecognition: undefined
    })
    vi.spyOn(sessionMessageService as any, 'getPersistedAgent').mockResolvedValue({
      id: 'agent-1',
      type: 'claude-code',
      name: 'Agent',
      description: '',
      instructions: 'Use docs when needed',
      accessible_paths: ['/tmp'],
      model: 'anthropic:claude-sonnet-4',
      configuration: {},
      knowledge_bases: [mockKnowledgeBase],
      knowledgeRecognition: 'on',
      knowledge_base_configs: runtimeConfigs,
      created_at: '2026-04-07T00:00:00.000Z',
      updated_at: '2026-04-07T00:00:00.000Z'
    })
    vi.spyOn(sessionMessageService as any, 'loadGlobalAgentContextSettings').mockResolvedValue({
      strategy: { type: 'none' },
      summarizationModelId: null
    })

    invokeMock.mockImplementation(async () => {
      const stream = createClaudeStream()
      setTimeout(() => {
        stream.emit('data', { type: 'chunk', chunk: { type: 'text-start' } })
        stream.emit('data', { type: 'chunk', chunk: { type: 'text-delta', text: 'Answer from agent' } })
        stream.emit('data', { type: 'chunk', chunk: { type: 'text-end' } })
        stream.emit('data', { type: 'complete' })
      }, 0)
      return stream as any
    })

    const { stream, completion } = await sessionMessageService.createSessionMessage(
      baseSession as any,
      { content: 'Where is the install guide?' } as any,
      new AbortController(),
      { persist: true }
    )

    const parts = await readAllParts(stream)
    await completion

    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(resolveScopedSkillConfigMock).toHaveBeenCalledWith([
      { type: 'agent', id: 'agent-1' },
      { type: 'session', id: 'session-1' }
    ])
    expect(loadInstalledSkillSelectionResourcesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contextManagementMethod: 'truncate',
        selectionMethod: 'hybrid'
      }),
      {
        scopes: [
          { type: 'agent', id: 'agent-1' },
          { type: 'session', id: 'session-1' }
        ]
      }
    )
    expect(invokeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'prepared-agent-turn',
        prompt: expect.stringContaining('Please answer the question based on the reference materials'),
        context: expect.objectContaining({
          knowledgeReferences: expect.arrayContaining([
            expect.objectContaining({
              content: 'Knowledge base answer',
              sourceUrl: 'docs.md'
            })
          ])
        })
      }),
      expect.objectContaining({ id: 'session-1' }),
      expect.any(AbortController),
      '',
      expect.any(Object),
      undefined
    )
    expect(parts.map((part) => part.type)).toEqual(
      expect.arrayContaining(['data-external-tool-in-progress', 'data-external-tool-complete'])
    )
    expect(persistExchangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        assistant: expect.objectContaining({
          payload: expect.objectContaining({
            blocks: expect.arrayContaining([
              expect.objectContaining({
                type: 'citation',
                knowledge: [
                  expect.objectContaining({
                    content: 'Knowledge base answer',
                    sourceUrl: 'docs.md'
                  })
                ]
              })
            ])
          })
        })
      })
    )
  })

  it('uses the session override to disable retrieval even when the agent default is on', async () => {
    vi.spyOn(sessionMessageService as any, 'getLastAgentSessionId').mockResolvedValue('')
    vi.spyOn(sessionMessageService as any, 'getPersistedSession').mockResolvedValue({
      ...baseSession,
      knowledge_bases: [mockKnowledgeBase],
      knowledgeRecognition: 'off',
      knowledge_base_configs: runtimeConfigs
    })
    vi.spyOn(sessionMessageService as any, 'getPersistedAgent').mockResolvedValue({
      id: 'agent-1',
      type: 'claude-code',
      name: 'Agent',
      description: '',
      instructions: '',
      accessible_paths: ['/tmp'],
      model: 'anthropic:claude-sonnet-4',
      configuration: {},
      knowledge_bases: [mockKnowledgeBase],
      knowledgeRecognition: 'on',
      knowledge_base_configs: runtimeConfigs,
      created_at: '2026-04-07T00:00:00.000Z',
      updated_at: '2026-04-07T00:00:00.000Z'
    })
    vi.spyOn(sessionMessageService as any, 'loadGlobalAgentContextSettings').mockResolvedValue({
      strategy: { type: 'none' },
      summarizationModelId: null
    })

    invokeMock.mockImplementation(async () => {
      const stream = createClaudeStream()
      setTimeout(() => {
        stream.emit('data', { type: 'complete' })
      }, 0)
      return stream as any
    })

    const { stream, completion } = await sessionMessageService.createSessionMessage(
      baseSession as any,
      { content: 'What changed?' } as any,
      new AbortController()
    )

    await readAllParts(stream)
    await completion

    expect(searchMock).not.toHaveBeenCalled()
    expect(invokeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'prepared-agent-turn',
        prompt: 'What changed?',
        originalPrompt: 'What changed?'
      }),
      expect.objectContaining({ id: 'session-1' }),
      expect.any(AbortController),
      '',
      expect.any(Object),
      undefined
    )
  })

  it('combines knowledge references and selected skills in the same runtime prompt', async () => {
    vi.spyOn(sessionMessageService as any, 'getLastAgentSessionId').mockResolvedValue('')
    vi.spyOn(sessionMessageService as any, 'getPersistedSession').mockResolvedValue({
      ...baseSession,
      knowledge_bases: [mockKnowledgeBase],
      knowledgeRecognition: 'on',
      knowledge_base_configs: runtimeConfigs
    })
    vi.spyOn(sessionMessageService as any, 'getPersistedAgent').mockResolvedValue({
      id: 'agent-1',
      type: 'claude-code',
      name: 'Agent',
      description: '',
      instructions: '',
      accessible_paths: ['/tmp'],
      model: 'anthropic:claude-sonnet-4',
      configuration: {},
      knowledge_bases: [mockKnowledgeBase],
      knowledgeRecognition: 'on',
      knowledge_base_configs: runtimeConfigs,
      created_at: '2026-04-07T00:00:00.000Z',
      updated_at: '2026-04-07T00:00:00.000Z'
    })
    vi.spyOn(sessionMessageService as any, 'loadGlobalAgentContextSettings').mockResolvedValue({
      strategy: { type: 'none' },
      summarizationModelId: null
    })
    resolveScopedSkillConfigMock.mockResolvedValue({
      enabled: true,
      maxSkillTokens: 1000,
      contextManagementMethod: 'truncate',
      selectionMethod: 'keyword'
    })
    buildSkillStreamPartsMock.mockImplementation(async ({ disabled, onPreparedSkills }) => {
      expect(disabled).toBe(false)
      onPreparedSkills?.([
        {
          skillId: 'skill-install',
          skillName: 'Install Guide',
          content: 'Use the install-guide skill steps.',
          activationMethod: 'keyword',
          selectionReason: 'Matched install guide',
          similarityScore: 1,
          matchedKeywords: ['install'],
          contextManagementMethod: 'truncate',
          originalTokenCount: 20,
          managedTokenCount: 10,
          tokensSaved: 10,
          truncated: false
        }
      ])
      return []
    })

    invokeMock.mockImplementation(async () => {
      const stream = createClaudeStream()
      setTimeout(() => {
        stream.emit('data', { type: 'complete' })
      }, 0)
      return stream as any
    })

    const { stream, completion } = await sessionMessageService.createSessionMessage(
      baseSession as any,
      { content: 'Where is the install guide?' } as any,
      new AbortController()
    )

    await readAllParts(stream)
    await completion

    const runtimeTurn = invokeMock.mock.calls[0][0]
    expect(runtimeTurn.prompt).toContain('Please answer the question based on the reference materials')
    expect(runtimeTurn.prompt).toContain('<activated_skills>')
    expect(runtimeTurn.prompt).toContain('Use the install-guide skill steps.')
    expect(runtimeTurn.context.skills).toEqual([
      expect.objectContaining({
        skillId: 'skill-install'
      })
    ])
    expect(runtimeTurn.context.knowledgeReferences).toEqual([
      expect.objectContaining({
        content: 'Knowledge base answer'
      })
    ])
  })

  it('uses and updates the runtime-specific session binding instead of the shared legacy id', async () => {
    vi.spyOn(sessionMessageService as any, 'getLastAgentSessionId').mockResolvedValue('legacy-shared-session')
    vi.spyOn(sessionMessageService as any, 'getPersistedSession').mockResolvedValue({
      ...baseSession,
      configuration: {
        runtime: {
          kind: 'codex',
          mode: 'managed'
        }
      }
    })
    vi.spyOn(sessionMessageService as any, 'getPersistedAgent').mockResolvedValue(null)
    vi.spyOn(sessionMessageService as any, 'loadGlobalAgentContextSettings').mockResolvedValue({
      strategy: { type: 'none' },
      summarizationModelId: null
    })
    runtimeBindingGetMock.mockResolvedValue('codex-thread-existing')
    resolveEffectiveRuntimeConfigMock.mockResolvedValue({
      kind: 'codex',
      mode: 'managed'
    })

    invokeMock.mockImplementation(async () => {
      const stream = createClaudeStream()
      stream.sdkSessionId = 'codex-thread-next'
      setTimeout(() => {
        stream.emit('data', { type: 'complete' })
      }, 0)
      return stream as any
    })

    const { stream, completion } = await sessionMessageService.createSessionMessage(
      baseSession as any,
      { content: 'Continue this task.' } as any,
      new AbortController()
    )

    await readAllParts(stream)
    await completion

    expect(runtimeBindingGetMock).toHaveBeenCalledWith('session-1', 'codex')
    expect(invokeMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        configuration: expect.objectContaining({
          runtime: {
            kind: 'codex',
            mode: 'managed'
          }
        })
      }),
      expect.any(AbortController),
      'codex-thread-existing',
      expect.any(Object),
      undefined
    )
    expect(runtimeBindingUpsertMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      agentId: 'agent-1',
      runtimeKind: 'codex',
      runtimeSessionId: 'codex-thread-next'
    })
  })
})
