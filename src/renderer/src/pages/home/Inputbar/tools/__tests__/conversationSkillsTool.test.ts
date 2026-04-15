import '../index'

import type { Assistant, Model, Topic } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { getToolsForScope } from '../index'

const assistant: Assistant = {
  id: 'assistant-1',
  name: 'Assistant',
  emoji: '😀',
  prompt: '',
  topics: [],
  messages: [],
  type: 'assistant',
  regularPhrases: [],
  settings: {
    contextCount: 10,
    temperature: 0,
    topP: 1,
    streamOutput: true,
    reasoning_effort: 'default',
    toolUseMode: 'function'
  }
}

const model: Model = {
  id: 'model-1',
  provider: 'openai',
  name: 'Model',
  group: 'openai',
  capabilities: []
}

const topic: Topic = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  name: 'Topic',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  messages: [],
  type: TopicType.Chat
}

describe('conversationSkillsTool', () => {
  it('registers a dedicated chat-scope skills tool and keeps the resource panel session-only', () => {
    const chatTools = getToolsForScope(TopicType.Chat, {
      assistant,
      model,
      conversation: {
        topic,
        updateTopic: () => {}
      }
    })
    const sessionTools = getToolsForScope(TopicType.Session, {
      assistant,
      model,
      session: {
        accessiblePaths: ['/tmp']
      }
    })

    expect(chatTools.map((tool) => tool.key)).toContain('conversation_skills')
    expect(chatTools.map((tool) => tool.key)).not.toContain('resource_panel')
    expect(sessionTools.map((tool) => tool.key)).toContain('resource_panel')
  })
})
