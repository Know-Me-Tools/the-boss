/**
 * Context Strategy Base Types and Interfaces
 *
 * This module provides the core interfaces and types for context management strategies.
 */

import type { Model } from '@renderer/types'
import type {
  ContextStrategy,
  ContextStrategyConfig,
  ContextStrategyContext,
  ContextStrategyResult
} from '@renderer/types/contextStrategy'
import type { Message } from '@renderer/types/newMessage'

// Re-export types for convenience
export type { ContextStrategy, ContextStrategyConfig, ContextStrategyContext, ContextStrategyResult }

/**
 * Base class for context strategies
 * Provides common functionality and default implementations
 */
export abstract class BaseContextStrategy implements ContextStrategy {
  abstract readonly name: ContextStrategy['name']
  abstract readonly description: string

  abstract apply(
    messages: Message[],
    config: ContextStrategyConfig,
    context: ContextStrategyContext
  ): Promise<ContextStrategyResult>

  /**
   * Create a result indicating the strategy was not applied
   */
  protected noOpResult(messages: Message[]): ContextStrategyResult {
    return {
      messages,
      messagesRemoved: 0,
      tokensSaved: 0,
      wasApplied: false
    }
  }

  /**
   * Check if strategy should be applied based on current token usage
   */
  protected shouldApply(context: ContextStrategyContext): boolean {
    return context.currentTokens > context.tokenBudget
  }
}

/**
 * Options for the summarization LLM call
 */
export interface SummarizationOptions {
  model: Model
  maxTokens: number
  systemPrompt?: string
}

/**
 * Cached summary data for a conversation
 */
export interface SummaryCache {
  summary: string
  messageIds: string[]
  createdAt: string
  tokenCount: number
}

/**
 * Long-term facts extracted from a conversation
 */
export interface ExtractedFacts {
  facts: string[]
  messageIds: string[]
  updatedAt: string
}
