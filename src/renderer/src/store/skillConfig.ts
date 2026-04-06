import type { PayloadAction } from '@reduxjs/toolkit'
import { createSelector, createSlice } from '@reduxjs/toolkit'
import type { AgentSkillConfigOverride, SkillGlobalConfig } from '@renderer/types/skillConfig'
import { DEFAULT_SKILL_CONFIG, resolveSkillConfig } from '@renderer/types/skillConfig'

import type { RootState } from '.'

interface SkillConfigState {
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
    setGlobalSkillConfig(state, action: PayloadAction<Partial<SkillGlobalConfig>>) {
      state.global = { ...state.global, ...action.payload }
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

export const selectGlobalSkillConfig = (state: RootState) => state.skillConfig.global

export const selectAgentSkillOverride = (state: RootState, agentId: string) => state.skillConfig.agentOverrides[agentId]

export const selectResolvedSkillConfig = createSelector(
  selectGlobalSkillConfig,
  selectAgentSkillOverride,
  (global, agentOverride) => resolveSkillConfig(global, agentOverride)
)

export default skillConfigSlice.reducer
