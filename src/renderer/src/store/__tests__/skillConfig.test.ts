import { DEFAULT_SKILL_CONFIG, getSkillMethodConfig, SkillSelectionMethod } from '@renderer/types/skillConfig'
import { describe, expect, it } from 'vitest'

import type { RootState } from '../index'
import skillConfigReducer, {
  clearAgentSkillOverride,
  selectAgentSkillOverride,
  selectGlobalSkillConfig,
  selectResolvedSkillConfig,
  selectResolvedSkillConfigFromOverrides,
  setAgentSkillOverride,
  setGlobalSkillConfig
} from '../skillConfig'

const initialState = skillConfigReducer(undefined, { type: '@@INIT' })

function makeState(overrides: Partial<ReturnType<typeof skillConfigReducer>> = {}): {
  skillConfig: ReturnType<typeof skillConfigReducer>
} {
  const base = skillConfigReducer(undefined, { type: '@@INIT' })
  return { skillConfig: { ...base, ...overrides } } as unknown as RootState
}

describe('skillConfig slice', () => {
  it('initializes with DEFAULT_SKILL_CONFIG', () => {
    expect(initialState.global).toEqual(DEFAULT_SKILL_CONFIG)
    expect(initialState.agentOverrides).toEqual({})
  })

  it('setGlobalSkillConfig merges method-aware updates into global', () => {
    const next = skillConfigReducer(
      initialState,
      setGlobalSkillConfig({
        selectionMethod: SkillSelectionMethod.LLM_ROUTER,
        methods: {
          [SkillSelectionMethod.LLM_ROUTER]: {
            llmModelId: 'router-model',
            topK: 6
          }
        }
      })
    )

    expect(next.global.selectionMethod).toBe(SkillSelectionMethod.LLM_ROUTER)
    expect(getSkillMethodConfig(next.global, SkillSelectionMethod.LLM_ROUTER).llmModelId).toBe('router-model')
    expect(getSkillMethodConfig(next.global, SkillSelectionMethod.LLM_ROUTER).topK).toBe(6)
    expect(getSkillMethodConfig(next.global, SkillSelectionMethod.EMBEDDING).topK).toBe(
      getSkillMethodConfig(DEFAULT_SKILL_CONFIG, SkillSelectionMethod.EMBEDDING).topK
    )
  })

  it('setAgentSkillOverride stores override keyed by agentId', () => {
    const next = skillConfigReducer(
      initialState,
      setAgentSkillOverride({
        agentId: 'agent-1',
        override: {
          methods: {
            [SkillSelectionMethod.EMBEDDING]: { topK: 5 }
          }
        }
      })
    )

    expect(next.agentOverrides['agent-1']).toEqual({
      methods: {
        [SkillSelectionMethod.EMBEDDING]: { topK: 5 }
      }
    })
  })

  it('clearAgentSkillOverride removes the override', () => {
    const withOverride = skillConfigReducer(
      initialState,
      setAgentSkillOverride({
        agentId: 'agent-1',
        override: { methods: { [SkillSelectionMethod.EMBEDDING]: { topK: 5 } } }
      })
    )
    const cleared = skillConfigReducer(withOverride, clearAgentSkillOverride('agent-1'))
    expect(cleared.agentOverrides['agent-1']).toBeUndefined()
  })
})

describe('selectors', () => {
  it('selectGlobalSkillConfig normalizes legacy persisted state', () => {
    const state = makeState({
      global: {
        selectionMethod: SkillSelectionMethod.LLM_ROUTER,
        embeddingModelId: 'legacy-embedding',
        llmModelId: 'legacy-router',
        topK: 8,
        contextManagementMethod: DEFAULT_SKILL_CONFIG.contextManagementMethod,
        maxSkillTokens: DEFAULT_SKILL_CONFIG.maxSkillTokens
      } as typeof DEFAULT_SKILL_CONFIG & {
        embeddingModelId: string
        llmModelId: string
        topK: number
        methods?: never
      }
    })

    const normalized = selectGlobalSkillConfig(state as RootState)
    expect(getSkillMethodConfig(normalized, SkillSelectionMethod.LLM_ROUTER).llmModelId).toBe('legacy-router')
    expect(getSkillMethodConfig(normalized, SkillSelectionMethod.EMBEDDING).embeddingModelId).toBe('legacy-embedding')
    expect(getSkillMethodConfig(normalized, SkillSelectionMethod.HYBRID).topK).toBe(8)
  })

  it('selectAgentSkillOverride returns override for known agentId', () => {
    const state = makeState({
      agentOverrides: {
        a1: { methods: { [SkillSelectionMethod.EMBEDDING]: { topK: 7 } } }
      }
    })
    expect(selectAgentSkillOverride(state as RootState, 'a1')).toEqual({
      methods: { [SkillSelectionMethod.EMBEDDING]: { topK: 7 } }
    })
  })

  it('selectResolvedSkillConfig returns global when no override exists', () => {
    const state = makeState()
    expect(selectResolvedSkillConfig(state as RootState, undefined)).toEqual(DEFAULT_SKILL_CONFIG)
  })

  it('selectResolvedSkillConfig merges override fields', () => {
    const state = makeState({
      agentOverrides: {
        a1: { methods: { [SkillSelectionMethod.EMBEDDING]: { topK: 10 } } }
      }
    })

    const resolved = selectResolvedSkillConfig(state as RootState, 'a1')
    expect(getSkillMethodConfig(resolved, SkillSelectionMethod.EMBEDDING).topK).toBe(10)
    expect(resolved.selectionMethod).toBe(DEFAULT_SKILL_CONFIG.selectionMethod)
  })

  it('selectResolvedSkillConfigFromOverrides applies later overrides after earlier ones', () => {
    const state = makeState()
    const resolved = selectResolvedSkillConfigFromOverrides(
      state as RootState,
      { methods: { [SkillSelectionMethod.EMBEDDING]: { topK: 4, similarityThreshold: 0.5 } } },
      { methods: { [SkillSelectionMethod.EMBEDDING]: { topK: 9 } } }
    )

    expect(getSkillMethodConfig(resolved, SkillSelectionMethod.EMBEDDING).topK).toBe(9)
    expect(getSkillMethodConfig(resolved, SkillSelectionMethod.EMBEDDING).similarityThreshold).toBe(0.5)
  })

  it('selectResolvedSkillConfigFromOverrides intersects selected skill ids across scopes', () => {
    const state = makeState({
      global: {
        ...DEFAULT_SKILL_CONFIG,
        selectedSkillIds: ['skill-a', 'skill-b', 'skill-c']
      }
    })

    const resolved = selectResolvedSkillConfigFromOverrides(
      state as RootState,
      {
        selectedSkillIds: ['skill-b', 'skill-c']
      },
      {
        selectedSkillIds: ['skill-c', 'skill-d']
      }
    )

    expect(resolved.selectedSkillIds).toEqual(['skill-c'])
  })

  it('selectResolvedSkillConfigFromOverrides preserves explicit disable-all overrides', () => {
    const state = makeState({
      global: {
        ...DEFAULT_SKILL_CONFIG,
        selectedSkillIds: ['skill-a', 'skill-b']
      }
    })

    const resolved = selectResolvedSkillConfigFromOverrides(state as RootState, {
      selectedSkillIds: []
    })

    expect(resolved.selectedSkillIds).toEqual([])
  })
})
