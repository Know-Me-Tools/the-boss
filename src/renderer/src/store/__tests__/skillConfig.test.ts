import { DEFAULT_SKILL_CONFIG, SkillSelectionMethod } from '@renderer/types/skillConfig'
import { describe, expect, it } from 'vitest'

import type { RootState } from '../index'
import skillConfigReducer, {
  clearAgentSkillOverride,
  selectAgentSkillOverride,
  selectGlobalSkillConfig,
  selectResolvedSkillConfig,
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

  it('setGlobalSkillConfig merges partial update into global', () => {
    const next = skillConfigReducer(
      initialState,
      setGlobalSkillConfig({ selectionMethod: SkillSelectionMethod.HYBRID })
    )
    expect(next.global.selectionMethod).toBe(SkillSelectionMethod.HYBRID)
    expect(next.global.topK).toBe(DEFAULT_SKILL_CONFIG.topK)
    expect(next.global.similarityThreshold).toBe(DEFAULT_SKILL_CONFIG.similarityThreshold)
  })

  it('setAgentSkillOverride stores override keyed by agentId', () => {
    const next = skillConfigReducer(initialState, setAgentSkillOverride({ agentId: 'agent-1', override: { topK: 5 } }))
    expect(next.agentOverrides['agent-1']).toEqual({ topK: 5 })
  })

  it('clearAgentSkillOverride removes the override', () => {
    const withOverride = skillConfigReducer(
      initialState,
      setAgentSkillOverride({ agentId: 'agent-1', override: { topK: 5 } })
    )
    const cleared = skillConfigReducer(withOverride, clearAgentSkillOverride('agent-1'))
    expect(cleared.agentOverrides['agent-1']).toBeUndefined()
  })

  it('multiple agent overrides are stored independently', () => {
    let state = initialState
    state = skillConfigReducer(state, setAgentSkillOverride({ agentId: 'a1', override: { topK: 5 } }))
    state = skillConfigReducer(state, setAgentSkillOverride({ agentId: 'a2', override: { topK: 10 } }))
    expect(state.agentOverrides['a1']).toEqual({ topK: 5 })
    expect(state.agentOverrides['a2']).toEqual({ topK: 10 })
  })
})

describe('selectors', () => {
  it('selectGlobalSkillConfig returns global from state', () => {
    const state = makeState()
    expect(selectGlobalSkillConfig(state as RootState)).toEqual(DEFAULT_SKILL_CONFIG)
  })

  it('selectAgentSkillOverride returns override for known agentId', () => {
    const state = makeState({ agentOverrides: { a1: { topK: 7 } } })
    expect(selectAgentSkillOverride(state as RootState, 'a1')).toEqual({ topK: 7 })
  })

  it('selectAgentSkillOverride returns undefined for unknown agentId', () => {
    const state = makeState()
    expect(selectAgentSkillOverride(state as RootState, 'missing')).toBeUndefined()
  })

  it('selectResolvedSkillConfig returns global when no override', () => {
    const state = makeState()
    expect(selectResolvedSkillConfig(state as RootState, undefined)).toEqual(DEFAULT_SKILL_CONFIG)
  })

  it('selectResolvedSkillConfig merges override fields', () => {
    const state = makeState({ agentOverrides: { a1: { topK: 10 } } })
    const resolved = selectResolvedSkillConfig(state as RootState, 'a1')
    expect(resolved.topK).toBe(10)
    expect(resolved.selectionMethod).toBe(DEFAULT_SKILL_CONFIG.selectionMethod)
  })
})
