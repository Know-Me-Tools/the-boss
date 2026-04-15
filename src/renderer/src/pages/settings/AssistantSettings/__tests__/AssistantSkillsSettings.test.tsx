import { DEFAULT_SKILL_CONFIG } from '@renderer/types/skillConfig'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type * as ReactI18Next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AssistantSkillsSettings from '../AssistantSkillsSettings'

let mockGlobalSkillConfig = DEFAULT_SKILL_CONFIG

vi.mock('@renderer/store', () => ({
  useAppSelector: (selector: (state: any) => unknown) =>
    selector({
      skillConfig: {
        global: mockGlobalSkillConfig
      }
    })
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useInstalledSkills: () => ({
    skills: [
      {
        id: 'skill-a',
        name: 'Skill A',
        description: 'Alpha skill',
        folderName: 'skill-a',
        source: 'local',
        sourceUrl: null,
        namespace: null,
        author: 'Author A',
        tags: [],
        contentHash: 'skill-a-hash',
        isEnabled: true,
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'skill-b',
        name: 'Skill B',
        description: 'Beta skill',
        folderName: 'skill-b',
        source: 'builtin',
        sourceUrl: null,
        namespace: null,
        author: null,
        tags: [],
        contentHash: 'skill-b-hash',
        isEnabled: true,
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'skill-c',
        name: 'Skill C',
        description: 'Gamma skill',
        folderName: 'skill-c',
        source: 'local',
        sourceUrl: null,
        namespace: null,
        author: null,
        tags: [],
        contentHash: 'skill-c-hash',
        isEnabled: false,
        createdAt: 1,
        updatedAt: 1
      }
    ],
    loading: false,
    error: null
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

describe('AssistantSkillsSettings', () => {
  beforeEach(() => {
    mockGlobalSkillConfig = DEFAULT_SKILL_CONFIG
  })

  it('creates an assistant-level allowlist override when toggling from inherited defaults', () => {
    const updateAssistantSettings = vi.fn()

    render(
      <AssistantSkillsSettings
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
        updateAssistantSettings={updateAssistantSettings}
      />
    )

    const skillCard = screen.getByText('Skill A').closest('.ant-card')
    expect(skillCard).toBeTruthy()
    fireEvent.click(within(skillCard as HTMLElement).getByRole('switch'))

    expect(updateAssistantSettings).toHaveBeenCalledWith({
      skillConfig: {
        selectedSkillIds: ['skill-b']
      }
    })
  })

  it('keeps an explicit none override when the last selected assistant skill is turned off', () => {
    const updateAssistantSettings = vi.fn()

    render(
      <AssistantSkillsSettings
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
            toolUseMode: 'function',
            skillConfig: {
              selectedSkillIds: ['skill-a']
            }
          }
        }}
        updateAssistantSettings={updateAssistantSettings}
      />
    )

    const skillCard = screen.getByText('Skill A').closest('.ant-card')
    expect(skillCard).toBeTruthy()
    fireEvent.click(within(skillCard as HTMLElement).getByRole('switch'))

    expect(updateAssistantSettings).toHaveBeenCalledWith({
      skillConfig: {
        selectedSkillIds: []
      }
    })
  })

  it('renders globally excluded skills as disabled with explanatory copy', () => {
    mockGlobalSkillConfig = {
      ...DEFAULT_SKILL_CONFIG,
      selectedSkillIds: ['skill-a']
    }

    render(
      <AssistantSkillsSettings
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

    expect(screen.getByText('Excluded by global skill defaults')).toBeInTheDocument()
  })
})
