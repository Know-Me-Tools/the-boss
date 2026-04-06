import type { ContextStrategyConfig } from '@types'
import { DEFAULT_AGENT_CONTEXT_STRATEGY_CONFIG } from '@types'

export type AgentConfigurationLike = {
  context_strategy?: Partial<ContextStrategyConfig> | undefined
}

function mergeConfigs(base: ContextStrategyConfig, override: Partial<ContextStrategyConfig>): ContextStrategyConfig {
  const merged: ContextStrategyConfig = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) {
      ;(merged as unknown as Record<string, unknown>)[key] = value
    }
  }
  return merged
}

export type EffectiveAgentContextInput = {
  globalStrategy: ContextStrategyConfig
  globalSummarizationModelId?: string | null
  agentConfiguration?: AgentConfigurationLike | null
  sessionConfiguration?: AgentConfigurationLike | null
}

/**
 * Resolve agent context strategy: session → agent → global → defaults.
 */
export function getEffectiveAgentContextStrategy(input: EffectiveAgentContextInput): ContextStrategyConfig {
  let config: ContextStrategyConfig = mergeConfigs({ ...DEFAULT_AGENT_CONTEXT_STRATEGY_CONFIG }, input.globalStrategy)

  if (input.agentConfiguration?.context_strategy) {
    config = mergeConfigs(config, input.agentConfiguration.context_strategy)
  }

  if (input.sessionConfiguration?.context_strategy) {
    config = mergeConfigs(config, input.sessionConfiguration.context_strategy)
  }

  if (!config.summarizationModelId && input.globalSummarizationModelId) {
    config = { ...config, summarizationModelId: input.globalSummarizationModelId }
  }

  return config
}

export function isAgentContextStrategyEnabled(config: ContextStrategyConfig): boolean {
  return config.type !== 'none'
}

/** Default token threshold when `compactTriggerTokens` is unset but strategy is active. */
export const DEFAULT_AGENT_COMPACT_TRIGGER_TOKENS = 180_000
