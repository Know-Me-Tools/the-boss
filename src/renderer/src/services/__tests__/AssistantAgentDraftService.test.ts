import type { Assistant, Topic } from '@renderer/types'
import { DEFAULT_SKILL_CONFIG } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { buildAgentDraftFromAssistant } from '../AssistantAgentDraftService'

describe('buildAgentDraftFromAssistant', () => {
  it('creates a conversion-ready agent draft with origin and skill metadata', () => {
    const assistant: Assistant = {
      id: 'assistant-1',
      name: 'Research Assistant',
      prompt: 'Use careful research.',
      topics: [],
      type: 'assistant',
      settings: {
        contextCount: 10,
        temperature: 0,
        topP: 1,
        streamOutput: true,
        reasoning_effort: 'default',
        toolUseMode: 'function'
      },
      mcpServers: [{ id: 'mcp-1' } as NonNullable<Assistant['mcpServers']>[number]],
      knowledgeRecognition: 'on',
      model: {
        id: 'claude-sonnet-4-5',
        provider: 'anthropic',
        name: 'Claude Sonnet 4.5',
        group: 'Claude'
      }
    }
    const topic = { id: 'topic-1', name: 'Topic' } as Topic
    const skillConfig = {
      ...DEFAULT_SKILL_CONFIG,
      selectedSkillIds: ['skill-a']
    }

    const draft = buildAgentDraftFromAssistant({ assistant, topic, skillConfig })

    expect(draft).toEqual(
      expect.objectContaining({
        type: 'claude-code',
        name: 'Research Assistant',
        instructions: 'Use careful research.',
        allowed_tools: [],
        accessible_paths: [],
        mcps: ['mcp-1'],
        knowledgeRecognition: 'on'
      })
    )
    expect(draft.model).toContain('claude-sonnet-4-5')
    expect(draft.configuration?.skill_config).toEqual(expect.objectContaining({ selectedSkillIds: ['skill-a'] }))
    expect(draft.configuration?.origin).toEqual({
      type: 'assistant',
      assistantId: 'assistant-1',
      topicId: 'topic-1'
    })
  })
})
