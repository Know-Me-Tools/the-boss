import store from '@renderer/store'
import { upsertOneBlock } from '@renderer/store/messageBlock'
import type { Assistant, Topic } from '@renderer/types'
import { DEFAULT_CONTEXT_STRATEGY_CONFIG } from '@renderer/types/contextStrategy'
import type { Message } from '@renderer/types/newMessage'
import { createMainTextBlock } from '@renderer/utils/messageUtils/create'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/utils/messageUtils/find', () => ({
  getMainTextContent: (message: Message & { content?: string }) => message.content ?? message.id
}))

import {
  applyChatContextStrategy,
  filterConversationMessagesForContext,
  hasContextStrategyOverride,
  resolveEffectiveChatContextStrategy
} from '../chatContextStrategy'

function createAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: 'assistant-1',
    name: 'Assistant',
    emoji: '😀',
    prompt: '',
    topics: [],
    messages: [],
    type: 'assistant',
    regularPhrases: [],
    settings: {
      contextCount: 5,
      temperature: 0,
      topP: 1,
      streamOutput: true,
      reasoning_effort: 'default',
      toolUseMode: 'function',
      ...overrides.settings
    },
    ...overrides
  }
}

function createTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 'topic-1',
    assistantId: 'assistant-1',
    name: 'Topic',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    ...overrides
  }
}

function createStrategyMessage(id: string, role: Message['role'] = 'user'): Message {
  const block = createMainTextBlock(id, `content-${id}`)
  store.dispatch(upsertOneBlock(block))

  return {
    id,
    role,
    assistantId: 'assistant-1',
    topicId: 'topic-1',
    createdAt: new Date().toISOString(),
    status: 'success',
    blocks: [block.id],
    type: 'text',
    content: `content-${id}`
  } as unknown as Message
}

describe('chatContextStrategy', () => {
  it('resolves precedence as global -> assistant -> topic', () => {
    const assistant = createAssistant({
      settings: {
        contextCount: 5,
        temperature: 0,
        topP: 1,
        streamOutput: true,
        reasoning_effort: 'default',
        toolUseMode: 'function',
        contextStrategy: { type: 'truncate_middle', keepFirstMessages: 2, keepLastMessages: 3 }
      }
    })
    const topic = createTopic({
      contextStrategy: { type: 'sliding_window', maxMessages: 4 }
    })

    const resolved = resolveEffectiveChatContextStrategy({
      globalStrategy: { ...DEFAULT_CONTEXT_STRATEGY_CONFIG, type: 'summarize', summaryMaxTokens: 900 },
      assistant,
      topic
    })

    expect(resolved.type).toBe('sliding_window')
    expect(resolved.maxMessages).toBe(4)
    expect(resolved.summaryMaxTokens).toBe(900)
  })

  it('detects inheritance when no local override exists', () => {
    expect(hasContextStrategyOverride(undefined)).toBe(false)
    expect(hasContextStrategyOverride({})).toBe(false)
    expect(hasContextStrategyOverride({ type: 'sliding_window' })).toBe(true)
  })

  it('applies sliding window using strategy maxMessages when present', () => {
    const messages = Array.from({ length: 8 }, (_, index) => createStrategyMessage(`m-${index}`))

    const filtered = applyChatContextStrategy(messages, {
      strategy: { ...DEFAULT_CONTEXT_STRATEGY_CONFIG, type: 'sliding_window', maxMessages: 3 },
      legacyContextCount: 5
    })

    expect(filtered.map((message) => message.id)).toEqual(['m-5', 'm-6', 'm-7'])
  })

  it('applies truncate_middle with configured head/tail preservation', () => {
    const messages = Array.from({ length: 8 }, (_, index) => createStrategyMessage(`m-${index}`))

    const filtered = applyChatContextStrategy(messages, {
      strategy: {
        ...DEFAULT_CONTEXT_STRATEGY_CONFIG,
        type: 'truncate_middle',
        keepFirstMessages: 2,
        keepLastMessages: 3
      },
      legacyContextCount: 5
    })

    expect(filtered.map((message) => message.id)).toEqual(['m-0', 'm-1', 'm-5', 'm-6', 'm-7'])
  })

  it('returns context-management telemetry when the effective strategy changes the prompt', () => {
    const assistant = createAssistant()
    const messages = [
      createStrategyMessage('m-0', 'user'),
      createStrategyMessage('m-1', 'assistant'),
      createStrategyMessage('m-2', 'user'),
      createStrategyMessage('m-3', 'assistant'),
      createStrategyMessage('m-4', 'user')
    ]

    const result = filterConversationMessagesForContext(
      messages,
      assistant,
      { ...DEFAULT_CONTEXT_STRATEGY_CONFIG, type: 'sliding_window', maxMessages: 3 },
      'topic-1'
    )

    expect(result.messages.map((message) => message.id)).toEqual(['m-2', 'm-3', 'm-4'])
    expect(result.telemetry).toMatchObject({
      surface: 'assistant',
      strategyType: 'sliding_window',
      originalMessageCount: 5,
      finalMessageCount: 3,
      messagesRemoved: 2,
      trigger: 'chat_pipeline'
    })
  })

  it('does not return context-management telemetry when the effective strategy leaves the prompt unchanged', () => {
    const assistant = createAssistant()
    const messages = [
      createStrategyMessage('m-0', 'user'),
      createStrategyMessage('m-1', 'assistant'),
      createStrategyMessage('m-2', 'user')
    ]

    const result = filterConversationMessagesForContext(
      messages,
      assistant,
      { ...DEFAULT_CONTEXT_STRATEGY_CONFIG, type: 'sliding_window', maxMessages: 5 },
      'topic-1'
    )

    expect(result.messages.map((message) => message.id)).toEqual(['m-0', 'm-1', 'm-2'])
    expect(result.telemetry).toBeUndefined()
  })
})
