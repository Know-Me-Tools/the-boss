import type { Assistant, SkillConfigOverride, SkillConfigScopeListRequest, SkillGlobalConfig } from '@renderer/types'
import { DEFAULT_SKILL_CONFIG } from '@renderer/types/skillConfig'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactI18Next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AssistantSkillsSettings from '../AssistantSkillsSettings'

let mockGlobalSkillConfig = DEFAULT_SKILL_CONFIG
const mockGetConfig = vi.fn()
const mockSetConfig = vi.fn()

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/pages/settings/components/ContextSkillsPanel', () => ({
  default: ({
    skillConfig,
    skillScopes,
    useInherited,
    onInheritedChange,
    onSkillConfigChange
  }: {
    skillConfig: SkillGlobalConfig
    skillScopes?: SkillConfigScopeListRequest
    useInherited?: boolean
    onInheritedChange: (useInherited: boolean) => void
    onSkillConfigChange: (patch: SkillConfigOverride) => void
  }) => (
    <div>
      <div data-testid="selected">{skillConfig.selectedSkillIds?.join(',') ?? 'all'}</div>
      <div data-testid="scope">{JSON.stringify(skillScopes)}</div>
      <div data-testid="inherited">{String(useInherited)}</div>
      <button type="button" onClick={() => onSkillConfigChange({ selectedSkillIds: [] })}>
        disable-skills
      </button>
      <button type="button" onClick={() => onInheritedChange(true)}>
        inherit
      </button>
    </div>
  )
}))

vi.mock('@renderer/store', () => ({
  useAppSelector: (selector: (state: any) => unknown) =>
    selector({
      skillConfig: {
        global: mockGlobalSkillConfig
      }
    })
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

describe('AssistantSkillsSettings', () => {
  beforeEach(() => {
    mockGlobalSkillConfig = DEFAULT_SKILL_CONFIG
    mockGetConfig.mockResolvedValue({ success: true, data: null })
    mockSetConfig.mockImplementation(({ scope, config }) =>
      Promise.resolve({
        success: true,
        data: {
          scopeType: scope.type,
          scopeId: scope.id,
          config,
          createdAt: 1,
          updatedAt: 2
        }
      })
    )

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        skillScope: {
          getConfig: mockGetConfig,
          setConfig: mockSetConfig
        }
      }
    })
  })

  it('writes assistant skill changes through skillScope IPC', async () => {
    render(<AssistantSkillsSettings assistant={assistant} />)

    await screen.findByTestId('selected')
    fireEvent.click(screen.getByText('disable-skills'))

    await waitFor(() => {
      expect(mockSetConfig).toHaveBeenCalledWith({
        scope: { type: 'assistant', id: 'assistant-1' },
        config: { selectedSkillIds: [] }
      })
    })
    expect(screen.getByTestId('scope')).toHaveTextContent('assistant')
  })

  it('uses legacy assistant skill config only when no DB scope exists', async () => {
    render(
      <AssistantSkillsSettings
        assistant={{
          ...assistant,
          settings: {
            ...assistant.settings,
            skillConfig: {
              selectedSkillIds: ['legacy-skill']
            }
          }
        }}
      />
    )

    expect(await screen.findByTestId('selected')).toHaveTextContent('legacy-skill')

    fireEvent.click(screen.getByText('inherit'))
    await waitFor(() => {
      expect(mockSetConfig).toHaveBeenCalledWith({
        scope: { type: 'assistant', id: 'assistant-1' },
        config: null
      })
    })
  })

  it('stops relying on legacy assistant skill config once a DB scope row exists', async () => {
    mockGetConfig.mockResolvedValue({
      success: true,
      data: {
        scopeType: 'assistant',
        scopeId: 'assistant-1',
        config: null,
        createdAt: 1,
        updatedAt: 1
      }
    })

    render(
      <AssistantSkillsSettings
        assistant={{
          ...assistant,
          settings: {
            ...assistant.settings,
            skillConfig: {
              selectedSkillIds: ['legacy-skill']
            }
          }
        }}
      />
    )

    expect(await screen.findByTestId('selected')).toHaveTextContent('all')
    expect(screen.getByTestId('inherited')).toHaveTextContent('true')
  })
})
