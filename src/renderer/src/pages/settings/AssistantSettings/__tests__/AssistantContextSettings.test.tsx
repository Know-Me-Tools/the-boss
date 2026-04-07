import { render, screen } from '@testing-library/react'
import type * as ReactI18Next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import AssistantContextSettings from '../AssistantContextSettings'

vi.mock('@renderer/store', () => ({
  useAppSelector: (selector: (state: any) => unknown) =>
    selector({
      settings: {
        contextStrategy: { type: 'sliding_window', maxMessages: 12 }
      }
    })
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'dark' })
}))

vi.mock('@renderer/components/ContextStrategySelector', () => ({
  default: () => <div data-testid="context-strategy-selector" />
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

describe('AssistantContextSettings', () => {
  it('renders assistant chat context settings with inherited defaults', () => {
    render(
      <AssistantContextSettings
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
        updateAssistantSettings={vi.fn()}
      />
    )

    expect(screen.getByText('Chat Context Management')).toBeInTheDocument()
    expect(
      screen.getByText('Use the global chat context strategy by default, or override it for this assistant.')
    ).toBeInTheDocument()
    expect(screen.getByTestId('context-strategy-selector')).toBeInTheDocument()
  })
})
