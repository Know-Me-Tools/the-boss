import { render, screen } from '@testing-library/react'
import type * as ReactI18Next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { ConversationSettingsPopupContainer } from '../ConversationSettingsPopup'

Object.defineProperty(window, 'api', {
  configurable: true,
  value: {
    ...(window as any).api,
    skillScope: {
      getConfig: vi.fn().mockResolvedValue({ success: true, data: null }),
      setConfig: vi.fn().mockResolvedValue({
        success: true,
        data: {
          scopeType: 'topic',
          scopeId: 'topic-1',
          config: null,
          createdAt: 1,
          updatedAt: 1
        }
      })
    }
  }
})

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: {
      id: 'assistant-1',
      name: 'Assistant',
      emoji: '😀',
      prompt: '',
      topics: [
        {
          id: 'topic-1',
          assistantId: 'assistant-1',
          name: 'Topic',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: []
        }
      ],
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
    },
    updateTopic: vi.fn()
  })
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'dark' })
}))

vi.mock('@renderer/store', () => ({
  useAppSelector: (selector: (state: any) => unknown) =>
    selector({
      settings: {
        contextStrategy: { type: 'sliding_window', maxMessages: 8 }
      },
      skillConfig: {
        global: undefined
      }
    })
}))

vi.mock('../components/ContextSkillsPanel', () => ({
  default: () => <div>skill panel</div>
}))

vi.mock('../components/ChatContextPanel', () => ({
  default: () => <div>chat context panel</div>
}))

vi.mock('../AgentSettings/BaseSettingsPopup', () => ({
  BaseSettingsPopup: ({ renderTabContent }: { renderTabContent: (tab: 'context-skills') => React.ReactNode }) => (
    <div>{renderTabContent('context-skills')}</div>
  )
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ReactI18Next
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
    })
  }
})

describe('ConversationSettingsPopupContainer', () => {
  it('renders chat context controls alongside the skill panel', () => {
    render(<ConversationSettingsPopupContainer assistantId="assistant-1" topicId="topic-1" resolve={vi.fn()} />)

    expect(screen.getByText('chat context panel')).toBeInTheDocument()
    expect(screen.getByText('skill panel')).toBeInTheDocument()
  })
})
