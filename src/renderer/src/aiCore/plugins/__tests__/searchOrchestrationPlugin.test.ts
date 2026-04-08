import type { Assistant, Model } from '@renderer/types'
import type * as AiModule from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateTextMock = vi.hoisted(() => vi.fn())
const selectGlobalMemoryEnabledMock = vi.hoisted(() => vi.fn(() => false))
const getDefaultModelMock = vi.hoisted(() =>
  vi.fn(() => ({ id: 'default-model', provider: 'openai', name: 'Default', group: 'chat' }))
)
const getProviderByModelMock = vi.hoisted(() => vi.fn(() => ({ id: 'openai', apiKey: 'test-key' })))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof AiModule>()
  return {
    ...actual,
    generateText: generateTextMock
  }
})

vi.mock('@renderer/services/AssistantService', () => {
  const createDefaultTopic = () => ({
    id: 'topic-default',
    assistantId: 'assistant-default',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Default Topic',
    messages: [],
    isNameManuallyEdited: false
  })

  const createDefaultAssistant = () => ({
    id: 'assistant-default',
    name: 'Default Assistant',
    emoji: '😀',
    topics: [createDefaultTopic()],
    messages: [],
    type: 'assistant',
    regularPhrases: [],
    settings: {}
  })

  return {
    getDefaultAssistant: vi.fn(() => createDefaultAssistant()),
    getDefaultTopic: vi.fn(() => createDefaultTopic()),
    getDefaultModel: getDefaultModelMock,
    getProviderByModel: getProviderByModelMock,
    getAssistantProvider: vi.fn(() => ({})),
    getAssistantById: vi.fn(() => createDefaultAssistant()),
    getQuickModel: vi.fn(() => null),
    getTranslateModel: vi.fn(() => null),
    getDefaultTranslateAssistant: vi.fn(() => createDefaultAssistant()),
    getAssistantSettings: vi.fn(() => ({})),
    DEFAULT_ASSISTANT_SETTINGS: {}
  }
})

vi.mock('@renderer/store', () => ({
  default: {
    getState: vi.fn(() => ({}))
  }
}))

vi.mock('@renderer/store/memory', () => ({
  selectCurrentUserId: vi.fn(() => null),
  selectGlobalMemoryEnabled: selectGlobalMemoryEnabledMock,
  selectMemoryConfig: vi.fn(() => ({}))
}))

vi.mock('@renderer/utils/extract', () => ({
  extractInfoFromXML: vi.fn(() => undefined)
}))

import { getMessageContent, searchOrchestrationPlugin } from '../searchOrchestrationPlugin'

const mockAssistant: Assistant = {
  id: 'assistant-1',
  name: 'Assistant',
  prompt: '',
  knowledge_bases: [
    {
      id: 'kb-1',
      name: 'Docs'
    } as any
  ],
  topics: [],
  type: 'assistant',
  model: {
    id: 'test-model',
    provider: 'openai',
    name: 'Test Model',
    group: 'chat'
  } as Model,
  enableMemory: false,
  enableWebSearch: false
}

describe('searchOrchestrationPlugin knowledge force mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds the knowledge search tool without intent analysis when force-search mode is selected', async () => {
    const assistant = {
      ...mockAssistant,
      knowledgeRecognition: 'off' as const
    }

    const plugin = searchOrchestrationPlugin(assistant, 'topic-1')
    const messages = [{ role: 'user' as const, content: 'Define the Foo term' }]
    const context = {
      requestId: 'req-1',
      originalParams: { messages },
      model: {}
    }

    await plugin.onRequestStart?.(context as never)

    const params = await plugin.transformParams?.(
      {
        messages,
        tools: {}
      } as never,
      context as never
    )

    expect(generateTextMock).not.toHaveBeenCalled()
    expect(params?.tools).toHaveProperty('builtin_knowledge_search')
    expect(getMessageContent(messages[0])).toBe('Define the Foo term')
  })
})
