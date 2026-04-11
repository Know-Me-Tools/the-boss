import { render } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PromptSettings from '../PromptSettings'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ReactI18next
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => fallback ?? key
    })
  }
})

vi.mock('@renderer/hooks/usePromptProcessor', () => ({
  usePromptProcessor: ({ prompt }: { prompt: string }) => prompt
}))

vi.mock('@renderer/services/TokenService', () => ({
  estimateTextTokens: (text: string) => text.length
}))

vi.mock('@renderer/components/CodeEditor', () => ({
  default: ({ value }: { value: string }) => <div data-testid="mock-code-editor">{value}</div>
}))

describe('PromptSettings', () => {
  beforeEach(() => {
    Object.assign(window.api, {
      getAppInfo: vi.fn().mockResolvedValue({}),
      file: window.api.file
    })
  })

  it('does not hide overflow on the outer settings scroll container', () => {
    const { container } = render(
      <PromptSettings
        agentBase={
          {
            id: 'agent-1',
            instructions: 'Long prompt content',
            model: 'gpt-test'
          } as any
        }
        update={vi.fn() as any}
      />
    )

    const scrollContainer = container.firstElementChild

    expect(scrollContainer).toBeInTheDocument()
    expect(scrollContainer).toHaveClass('h-full')
    expect(scrollContainer).not.toHaveClass('overflow-hidden')
  })
})
