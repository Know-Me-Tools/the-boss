import type { SkillGlobalConfig } from '@renderer/types/skillConfig'
import { DEFAULT_SKILL_CONFIG, resolveSkillConfig, SkillSelectionMethod } from '@renderer/types/skillConfig'
import { render, screen } from '@testing-library/react'
import type * as ReactI18Next from 'react-i18next'
import { beforeAll } from 'vitest'
import { describe, expect, it, vi } from 'vitest'

import ContextSkillsPanel from '../ContextSkillsPanel'

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: [
          { id: 'gpt-5', name: 'GPT-5', provider: 'openai' },
          { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large', provider: 'openai', group: 'Embedding' }
        ]
      }
    ]
  })
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useScopedSkills: () => ({
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
        contentHash: 'hash-a',
        isEnabled: true,
        createdAt: 1,
        updatedAt: 1
      }
    ],
    loading: false
  })
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  default: ({ placeholder }: { placeholder?: string }) => (
    <div data-testid="model-selector">{placeholder ?? 'model-selector'}</div>
  )
}))

vi.mock('@renderer/components/ContextStrategySelector', () => ({
  default: () => <div data-testid="context-strategy-selector" />
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ReactI18Next
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string }) =>
        options?.defaultValue ??
        {
          'settings.skill.title': 'Skill Configuration',
          'settings.skill.selection_method': 'Selection Method',
          'settings.skill.similarity_threshold': 'Similarity Threshold',
          'settings.skill.top_k': 'Max Skills (Top K)',
          'settings.skill.context_method': 'Context Management',
          'settings.skill.max_tokens': 'Max Skill Tokens',
          'settings.skill.method.embedding': 'Embedding (Semantic)',
          'settings.skill.method.hybrid': 'Hybrid (BM25 + Dense)',
          'settings.skill.method.llm_router': 'LLM Router',
          'settings.skill.method.two_stage': 'Two-Stage',
          'settings.skill.method.llm_delegated': 'LLM Delegated',
          'settings.skill.context.full_injection': 'Full Injection',
          'settings.skill.context.prefix_cache_aware': 'Prefix Cache Aware',
          'settings.skill.context.chunked_rag': 'Chunked RAG',
          'settings.skill.context.summarized': 'Summarized',
          'settings.skill.context.progressive': 'Progressive'
        }[key] ??
        key
    })
  }
})

function makeConfig(overrides = {}): SkillGlobalConfig {
  return resolveSkillConfig(DEFAULT_SKILL_CONFIG, overrides)
}

describe('ContextSkillsPanel', () => {
  beforeAll(() => {
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

  it('renders LLM-specific controls for LLM Router', () => {
    render(
      <ContextSkillsPanel
        skillConfig={makeConfig({
          selectionMethod: SkillSelectionMethod.LLM_ROUTER
        })}
        onSkillConfigChange={vi.fn()}
      />
    )

    expect(screen.getByText('Selection Method')).toBeInTheDocument()
    expect(screen.getByText('Embedding Model')).toBeInTheDocument()
    expect(screen.getByText('Routing LLM Model')).toBeInTheDocument()
    expect(screen.getByText('Similarity Threshold')).toBeInTheDocument()
    expect(screen.getByText('Max Skills (Top K)')).toBeInTheDocument()
  })

  it('hides non-applicable LLM and threshold controls for Hybrid', () => {
    render(
      <ContextSkillsPanel
        skillConfig={makeConfig({
          selectionMethod: SkillSelectionMethod.HYBRID
        })}
        onSkillConfigChange={vi.fn()}
      />
    )

    expect(screen.getByText('Embedding Model')).toBeInTheDocument()
    expect(screen.queryByText('Routing LLM Model')).not.toBeInTheDocument()
    expect(screen.queryByText('Similarity Threshold')).not.toBeInTheDocument()
  })
})
