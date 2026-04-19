import { render, screen } from '@testing-library/react'
import type * as ReactI18Next from 'react-i18next'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { AssistantSettingPopupContainer } from '../index'

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: {
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
    },
    updateAssistant: vi.fn(),
    updateAssistantSettings: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useAssistantPresets', () => ({
  useAssistantPreset: () => ({
    preset: null,
    updateAssistantPreset: vi.fn(),
    updateAssistantPresetSettings: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useSidebarIcon', () => ({
  useSidebarIconShow: () => true
}))

vi.mock('../AssistantModelSettings', () => ({
  default: () => <div>assistant model settings</div>
}))

vi.mock('../AssistantContextSettings', () => ({
  default: () => <div>assistant context settings</div>
}))

vi.mock('../AssistantSkillsSettings', () => ({
  default: () => <div>assistant skills settings</div>
}))

vi.mock('../AssistantPromptSettings', () => ({
  default: () => <div>assistant prompt settings</div>
}))

vi.mock('../AssistantKnowledgeBaseSettings', () => ({
  default: () => <div>assistant knowledge settings</div>
}))

vi.mock('../AssistantMCPSettings', () => ({
  default: () => <div>assistant mcp settings</div>
}))

vi.mock('../AssistantRegularPromptsSettings', () => ({
  default: () => <div>assistant regular prompts settings</div>
}))

vi.mock('../AssistantMemorySettings', () => ({
  default: () => <div>assistant memory settings</div>
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ReactI18Next
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string }) =>
        options?.defaultValue ??
        {
          'assistants.settings.model': 'Model Settings',
          'assistants.settings.prompt': 'Prompt Settings',
          'assistants.settings.knowledge_base.label': 'Knowledge Base Settings',
          'assistants.settings.mcp.label': 'MCP Servers',
          'assistants.settings.regular_phrases.title': 'Regular Phrase',
          'settings.contextStrategy.title': 'Context Management',
          'memory.title': 'Memories'
        }[key] ??
        key
    })
  }
})

describe('AssistantSettingPopupContainer', () => {
  beforeAll(() => {
    ;(window as any).api = {
      ...(window as any).api,
      getAppInfo: vi.fn().mockResolvedValue({
        appPath: '/tmp',
        homePath: '/tmp'
      })
    }

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    })
  })

  it('exposes DB-backed assistant-scoped skill settings', () => {
    render(
      <AssistantSettingPopupContainer
        assistant={{
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
        }}
        resolve={vi.fn()}
      />
    )

    expect(screen.getByText('Skills')).toBeInTheDocument()
    expect(screen.getByText('assistant model settings')).toBeInTheDocument()
  })
})
