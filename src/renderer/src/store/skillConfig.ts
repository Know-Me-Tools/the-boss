import type { PayloadAction } from '@reduxjs/toolkit'
import { createSelector, createSlice } from '@reduxjs/toolkit'
import type { AgentSkillConfigOverride, SkillConfigOverride, SkillGlobalConfig } from '@renderer/types/skillConfig'
import {
  applySkillConfigOverride,
  DEFAULT_SKILL_CONFIG,
  normalizeSkillConfig,
  resolveSkillConfig
} from '@renderer/types/skillConfig'

import type { RootState } from '.'

export interface SkillConfigState {
  global: SkillGlobalConfig
  agentOverrides: Record<string, AgentSkillConfigOverride>
}

const initialState: SkillConfigState = {
  global: DEFAULT_SKILL_CONFIG,
  agentOverrides: {}
}

const skillConfigSlice = createSlice({
  name: 'skillConfig',
  initialState,
  reducers: {
    setGlobalSkillConfig(state, action: PayloadAction<SkillConfigOverride>) {
      state.global = applySkillConfigOverride(normalizeSkillConfig(state.global), action.payload)
    },
    setAgentSkillOverride(state, action: PayloadAction<{ agentId: string; override: AgentSkillConfigOverride }>) {
      state.agentOverrides[action.payload.agentId] = action.payload.override
    },
    clearAgentSkillOverride(state, action: PayloadAction<string>) {
      delete state.agentOverrides[action.payload]
    }
  }
})

export const { setGlobalSkillConfig, setAgentSkillOverride, clearAgentSkillOverride } = skillConfigSlice.actions

export const selectGlobalSkillConfig = createSelector([(state: RootState) => state.skillConfig.global], (global) =>
  normalizeSkillConfig(global)
)

export const selectAgentSkillOverride = (state: RootState, agentId: string | undefined) =>
  agentId !== undefined ? state.skillConfig.agentOverrides[agentId] : undefined

export const selectResolvedSkillConfigFromOverrides = (
  state: RootState,
  ...overrides: Array<SkillConfigOverride | undefined | null>
) => resolveSkillConfig(selectGlobalSkillConfig(state), ...overrides)

export const selectResolvedSkillConfig = createSelector(
  selectGlobalSkillConfig,
  selectAgentSkillOverride,
  (global, agentOverride) => resolveSkillConfig(global, agentOverride)
)

export default skillConfigSlice.reducer
