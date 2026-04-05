/**
 * Context Management Strategies Module
 *
 * This module provides context window management strategies to prevent
 * "Prompt is too long" errors when interacting with LLMs.
 *
 * Available strategies:
 * - sliding_window: Keep most recent messages within token budget
 * - summarize: Progressively summarize older messages
 * - hierarchical: Three-tier memory (short/mid/long-term)
 * - truncate_middle: Keep first + last messages, remove middle
 *
 * Usage:
 * ```typescript
 * import { applyContextStrategy, getEffectiveStrategyConfig } from '@renderer/services/contextStrategies'
 *
 * const config = getEffectiveStrategyConfig(topic, assistant)
 * const result = await applyContextStrategy(messages, config, context)
 * ```
 */

import { loggerService } from '@logger'
import { getAvailableInputBudget } from '@renderer/config/models/contextLimits'
import { estimateConversationTokens } from '@renderer/services/TokenService'
import type { Assistant, ContextStrategyConfig, ContextStrategyType, Model, Topic } from '@renderer/types'
import type { ContextStrategyContext, ContextStrategyResult } from '@renderer/types/contextStrategy'
import type { Message } from '@renderer/types/newMessage'

import { getEffectiveStrategyConfig, isContextStrategyEnabled } from './configResolver'
import { HierarchicalMemoryStrategy } from './HierarchicalMemoryStrategy'
import { SlidingWindowStrategy } from './SlidingWindowStrategy'
import { SummarizationStrategy } from './SummarizationStrategy'
import { TruncateMiddleStrategy } from './TruncateMiddleStrategy'
import type { ContextStrategy } from './types'

const logger = loggerService.withContext('ContextStrategies')

// Export all strategies
export { HierarchicalMemoryStrategy } from './HierarchicalMemoryStrategy'
export { SlidingWindowStrategy } from './SlidingWindowStrategy'
export { SummarizationStrategy } from './SummarizationStrategy'
export { TruncateMiddleStrategy } from './TruncateMiddleStrategy'

// Export configuration utilities
export {
  describeConfig,
  getEffectiveStrategyConfig,
  getSummarizationModelId,
  isContextStrategyEnabled
} from './configResolver'

// Export types
export type { ContextStrategy, ContextStrategyContext, ContextStrategyResult } from './types'

/**
 * Strategy instances (lazy initialized)
 */
const strategies: Record<Exclude<ContextStrategyType, 'none'>, ContextStrategy> = {
  sliding_window: new SlidingWindowStrategy(),
  summarize: new SummarizationStrategy(),
  hierarchical: new HierarchicalMemoryStrategy(),
  truncate_middle: new TruncateMiddleStrategy()
}

/**
 * Get a strategy instance by type
 *
 * @param type - The strategy type
 * @returns The strategy instance, or undefined for 'none'
 */
export function getStrategy(type: ContextStrategyType): ContextStrategy | undefined {
  if (type === 'none') {
    return undefined
  }

  return strategies[type]
}

/**
 * Apply the configured context strategy to messages
 *
 * This is the main entry point for context management. It:
 * 1. Resolves the effective configuration
 * 2. Checks if strategy should be applied
 * 3. Applies the appropriate strategy
 * 4. Returns the processed messages and metadata
 *
 * @param messages - The messages to process
 * @param model - The model being used (for context limits)
 * @param options - Additional options
 * @returns The strategy result with processed messages
 */
export async function applyContextStrategy(
  messages: Message[],
  model: Model,
  options: {
    topic?: Topic
    assistant?: Assistant
    systemPrompt?: string
    maxOutputTokens?: number
    existingSummary?: string
    existingFacts?: string[]
    toolTokens?: number
    knowledgeTokens?: number
  } = {}
): Promise<ContextStrategyResult> {
  const {
    topic,
    assistant,
    systemPrompt,
    maxOutputTokens,
    existingSummary,
    existingFacts,
    toolTokens = 0,
    knowledgeTokens = 0
  } = options

  // Get effective configuration
  const config = getEffectiveStrategyConfig(topic, assistant)

  // Check if strategy is enabled
  if (!isContextStrategyEnabled(config)) {
    logger.debug('Context strategy disabled (type: none)')
    return {
      messages,
      messagesRemoved: 0,
      tokensSaved: 0,
      wasApplied: false
    }
  }

  // Get strategy instance
  const strategy = getStrategy(config.type)
  if (!strategy) {
    logger.warn('Unknown strategy type, returning original messages', { type: config.type })
    return {
      messages,
      messagesRemoved: 0,
      tokensSaved: 0,
      wasApplied: false
    }
  }

  // Calculate token budget and current usage
  // IMPORTANT: Subtract tool AND knowledge tokens from available budget since they consume context space
  const rawTokenBudget = getAvailableInputBudget(model, maxOutputTokens)
  const overheadTokens = toolTokens + knowledgeTokens
  const tokenBudget = Math.max(0, rawTokenBudget - overheadTokens)
  const currentTokens = estimateConversationTokens(messages, systemPrompt)

  if (overheadTokens > 0) {
    logger.debug('Token overhead applied to budget', {
      rawBudget: rawTokenBudget,
      toolTokens,
      knowledgeTokens,
      totalOverhead: overheadTokens,
      effectiveBudget: tokenBudget
    })
  }

  // Build context for strategy
  const context: ContextStrategyContext = {
    model,
    tokenBudget,
    currentTokens,
    toolTokens,
    knowledgeTokens,
    systemPrompt,
    topicId: topic?.id,
    existingSummary,
    existingFacts
  }

  logger.debug('Applying context strategy', {
    strategy: config.type,
    messageCount: messages.length,
    currentTokens,
    tokenBudget,
    isOverBudget: currentTokens > tokenBudget
  })

  // Apply the strategy
  try {
    const result = await strategy.apply(messages, config, context)

    if (result.wasApplied) {
      logger.info('Context strategy applied successfully', {
        strategy: config.type,
        messagesRemoved: result.messagesRemoved,
        tokensSaved: result.tokensSaved,
        finalMessageCount: result.messages.length
      })
    }

    return result
  } catch (error) {
    logger.error('Error applying context strategy, returning original messages', error as Error)
    return {
      messages,
      messagesRemoved: 0,
      tokensSaved: 0,
      wasApplied: false
    }
  }
}

/**
 * Check if context management should be applied for a conversation
 *
 * @param messages - The messages to check
 * @param model - The model being used
 * @param systemPrompt - Optional system prompt
 * @returns True if context management should be applied
 */
export function shouldApplyContextManagement(messages: Message[], model: Model, systemPrompt?: string): boolean {
  const tokenBudget = getAvailableInputBudget(model)
  const currentTokens = estimateConversationTokens(messages, systemPrompt)

  return currentTokens > tokenBudget
}

/**
 * Get a preview of what a strategy would do without actually applying it
 *
 * @param messages - The messages to analyze
 * @param config - The strategy configuration
 * @param model - The model being used
 * @param systemPrompt - Optional system prompt
 * @returns Preview information about what would happen
 */
export function previewStrategyEffect(
  messages: Message[],
  config: ContextStrategyConfig,
  model: Model,
  systemPrompt?: string
): {
  wouldApply: boolean
  estimatedMessagesToRemove: number
  estimatedTokensSaved: number
  currentTokens: number
  tokenBudget: number
} {
  const tokenBudget = getAvailableInputBudget(model)
  const currentTokens = estimateConversationTokens(messages, systemPrompt)
  const wouldApply = currentTokens > tokenBudget && config.type !== 'none'

  // Rough estimate of what would be removed
  let estimatedMessagesToRemove = 0
  let estimatedTokensSaved = 0

  if (wouldApply) {
    const overBudget = currentTokens - tokenBudget
    // Estimate based on average tokens per message
    const avgTokensPerMessage = currentTokens / messages.length
    estimatedMessagesToRemove = Math.ceil(overBudget / avgTokensPerMessage)
    estimatedTokensSaved = overBudget
  }

  return {
    wouldApply,
    estimatedMessagesToRemove,
    estimatedTokensSaved,
    currentTokens,
    tokenBudget
  }
}
