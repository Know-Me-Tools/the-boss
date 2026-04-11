import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { buildSkillStreamPartsMock, invokeMock, persistExchangeMock, reduxSelectMock, searchMock, rerankMock } =
  vi.hoisted(() => ({
    buildSkillStreamPartsMock: vi.fn().mockResolvedValue([]),
    invokeMock: vi.fn(),
    persistExchangeMock: vi.fn().mockResolvedValue({}),
    reduxSelectMock: vi.fn(),
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

vi.mock('@main/services/skills/buildSkillStreamParts', () => ({
  buildSkillStreamParts: buildSkillStreamPartsMock
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
    vi.spyOn(sessionMessageService as any, 'loadGlobalSkillConfig').mockResolvedValue({
      enabled: false,
      maxSkillTokens: 1000,
      contextManagementMethod: 'truncate',
      selectionMethod: 'hybrid'
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
    expect(invokeMock).toHaveBeenCalledWith(
      expect.stringContaining('Please answer the question based on the reference materials'),
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
    vi.spyOn(sessionMessageService as any, 'loadGlobalSkillConfig').mockResolvedValue({
      enabled: false,
      maxSkillTokens: 1000,
      contextManagementMethod: 'truncate',
      selectionMethod: 'hybrid'
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
      'What changed?',
      expect.objectContaining({ id: 'session-1' }),
      expect.any(AbortController),
      '',
      expect.any(Object),
      undefined
    )
  })
})
