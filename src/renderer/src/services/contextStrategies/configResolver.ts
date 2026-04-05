/**
 * Context Strategy Configuration Resolver
 *
 * This module handles the configuration inheritance chain for context strategies:
 * Topic (Conversation) → Assistant → Global Settings
 *
 * More specific settings override less specific ones.
 */

import { loggerService } from '@logger'
import store from '@renderer/store'
import type { Assistant, ContextStrategyConfig, Topic } from '@renderer/types'
import { DEFAULT_CONTEXT_STRATEGY_CONFIG } from '@renderer/types/contextStrategy'

const logger = loggerService.withContext('ContextStrategyConfigResolver')

/**
 * Get the effective context strategy configuration by resolving the inheritance chain
 *
 * Priority (highest to lowest):
 * 1. Topic/Conversation specific config
 * 2. Assistant specific config
 * 3. Global settings config
 * 4. Default config
 *
 * @param topic - The current topic/conversation (optional)
 * @param assistant - The current assistant (optional)
 * @returns The resolved context strategy configuration
 */
export function getEffectiveStrategyConfig(topic?: Topic, assistant?: Assistant): ContextStrategyConfig {
  // Start with default config
  let config: ContextStrategyConfig = { ...DEFAULT_CONTEXT_STRATEGY_CONFIG }

  // Layer 1: Apply global settings
  const globalSettings = store.getState().settings
  if (globalSettings.contextStrategy) {
    config = mergeConfigs(config, globalSettings.contextStrategy)
    logger.debug('Applied global context strategy config', { type: config.type })
  }

  // Layer 2: Apply assistant settings (if available)
  if (assistant?.settings?.contextStrategy) {
    config = mergeConfigs(config, assistant.settings.contextStrategy)
    logger.debug('Applied assistant context strategy config', {
      assistantId: assistant.id,
      type: config.type
    })
  }

  // Layer 3: Apply topic settings (if available)
  if (topic?.contextStrategy) {
    config = mergeConfigs(config, topic.contextStrategy)
    logger.debug('Applied topic context strategy config', {
      topicId: topic.id,
      type: config.type
    })
  }

  return config
}

/**
 * Merge two configurations, with the override taking precedence for defined values
 */
function mergeConfigs(base: ContextStrategyConfig, override: Partial<ContextStrategyConfig>): ContextStrategyConfig {
  const merged: ContextStrategyConfig = { ...base }

  // Only copy defined values from override
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) {
      ;(merged as unknown as Record<string, unknown>)[key] = value
    }
  }

  return merged
}

/**
 * Get the model ID to use for summarization
 *
 * Priority:
 * 1. Strategy config's summarizationModelId
 * 2. Global contextSummarizationModelId setting
 * 3. Quick model from assistants (fallback)
 *
 * @param config - The context strategy config
 * @returns The model ID to use for summarization, or undefined if none configured
 */
export function getSummarizationModelId(config: ContextStrategyConfig): string | undefined {
  // Check strategy-specific config first
  if (config.summarizationModelId) {
    return config.summarizationModelId
  }

  // Check global setting
  const globalSettings = store.getState().settings
  if (globalSettings.contextSummarizationModelId) {
    return globalSettings.contextSummarizationModelId
  }

  // No specific model configured - caller should use quick model or current model
  return undefined
}

/**
 * Check if context strategy is enabled (not 'none')
 */
export function isContextStrategyEnabled(config: ContextStrategyConfig): boolean {
  return config.type !== 'none'
}

/**
 * Get a human-readable description of the current configuration
 */
export function describeConfig(config: ContextStrategyConfig): string {
  const parts: string[] = []

  parts.push(`Strategy: ${config.type}`)

  switch (config.type) {
    case 'sliding_window':
      if (config.maxMessages) {
        parts.push(`Max messages: ${config.maxMessages}`)
      }
      break

    case 'summarize':
      if (config.summaryMaxTokens) {
        parts.push(`Summary budget: ${config.summaryMaxTokens} tokens`)
      }
      if (config.summarizeThreshold) {
        parts.push(`Summarize threshold: ${config.summarizeThreshold} messages`)
      }
      break

    case 'hierarchical':
      if (config.shortTermTurns) {
        parts.push(`Short-term: ${config.shortTermTurns} turns`)
      }
      if (config.midTermSummaryTokens) {
        parts.push(`Mid-term budget: ${config.midTermSummaryTokens} tokens`)
      }
      if (config.longTermFactsTokens) {
        parts.push(`Long-term budget: ${config.longTermFactsTokens} tokens`)
      }
      break

    case 'truncate_middle':
      if (config.keepFirstMessages) {
        parts.push(`Keep first: ${config.keepFirstMessages}`)
      }
      if (config.keepLastMessages) {
        parts.push(`Keep last: ${config.keepLastMessages}`)
      }
      break
  }

  return parts.join(', ')
}
