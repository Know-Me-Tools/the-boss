import { ContextManagementMethod, DEFAULT_SKILL_CONFIG, SkillSelectionMethod } from '@renderer/types/skillConfig'
import { render, screen } from '@testing-library/react'
import type * as ReactI18Next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import AssistantSkillSettingsSummary from '../AssistantSkillSettingsSummary'

vi.mock('@renderer/store', () => ({
  useAppSelector: (selector: (state: any) => unknown) =>
    selector({
      skillConfig: {
        global: DEFAULT_SKILL_CONFIG
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
        author: null,
        tags: [],
        contentHash: 'skill-a-hash',
        isEnabled: true,
        createdAt: 1,
        updatedAt: 1
      }
    ],
    loading: false
  })
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ReactI18Next
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string; count?: number; method?: string; strategy?: string }) => {
        if (options?.defaultValue) {
          return options.defaultValue
            .replace('{{count}}', String(options.count ?? ''))
            .replace('{{method}}', String(options.method ?? ''))
            .replace('{{strategy}}', String(options.strategy ?? ''))
        }
        return key
      }
    })
  }
})

describe('AssistantSkillSettingsSummary', () => {
  it('renders a live-derived assistant skill summary with strategy information', () => {
    render(
      <AssistantSkillSettingsSummary
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
              selectionMethod: SkillSelectionMethod.HYBRID,
              contextManagementMethod: ContextManagementMethod.SUMMARIZED,
              selectedSkillIds: ['skill-a']
            }
          }
        }}
        onConfigure={vi.fn()}
      />
    )

    expect(screen.getByText('Skills')).toBeInTheDocument()
    expect(screen.getByText('Selected skills only · 1 selected')).toBeInTheDocument()
    expect(screen.getByText('Selection: Hybrid')).toBeInTheDocument()
    expect(screen.getByText('Context: Summarized')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configure' })).toBeInTheDocument()
  })
})
