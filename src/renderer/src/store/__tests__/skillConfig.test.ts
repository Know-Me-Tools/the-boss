import { DEFAULT_SKILL_CONFIG, SkillSelectionMethod } from '@renderer/types/skillConfig'
import { describe, expect, it } from 'vitest'

import skillConfigReducer, {
  clearAgentSkillOverride,
  setAgentSkillOverride,
  setGlobalSkillConfig
} from '../skillConfig'

const initialState = skillConfigReducer(undefined, { type: '@@INIT' })

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
