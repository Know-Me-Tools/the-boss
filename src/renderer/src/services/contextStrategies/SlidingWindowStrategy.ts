/**
 * Sliding Window Context Management Strategy
 *
 * This strategy keeps only the most recent messages that fit within the token budget.
 * It's the simplest and most predictable approach - essentially a rolling window
 * that discards older messages when the context limit is approached.
 *
 * Pros:
 * - Simple and predictable behavior
 * - No additional LLM calls required
 * - Preserves most recent context perfectly
 *
 * Cons:
 * - Loses all information from older messages
 * - May lose important initial instructions or context
 */

import { loggerService } from '@logger'
import { estimateSingleMessageTokens, estimateTextTokens } from '@renderer/services/TokenService'
import type { Message } from '@renderer/types/newMessage'

import type { ContextStrategyConfig, ContextStrategyContext, ContextStrategyResult } from './types'
import { BaseContextStrategy } from './types'

const logger = loggerService.withContext('SlidingWindowStrategy')

export class SlidingWindowStrategy extends BaseContextStrategy {
  readonly name = 'sliding_window' as const
  readonly description = 'Keeps only the most recent messages within the token budget'

  async apply(
    messages: Message[],
    config: ContextStrategyConfig,
    context: ContextStrategyContext
  ): Promise<ContextStrategyResult> {
    // Check if we need to apply the strategy
    if (!this.shouldApply(context)) {
      logger.debug('Context within budget, no truncation needed', {
        currentTokens: context.currentTokens,
        budget: context.tokenBudget
      })
      return this.noOpResult(messages)
    }

    logger.info('Applying sliding window strategy', {
      messageCount: messages.length,
      currentTokens: context.currentTokens,
      budget: context.tokenBudget,
      overBudgetBy: context.currentTokens - context.tokenBudget
    })

    // Calculate available budget for messages (excluding system prompt)
    const systemPromptTokens = context.systemPrompt ? estimateTextTokens(context.systemPrompt) : 0
    const availableBudget = context.tokenBudget - systemPromptTokens

    // If maxMessages is configured, also limit by message count
    const maxMessages = config.maxMessages

    // Build the result by iterating from most recent to oldest
    const keptMessages: Message[] = []
    let totalTokens = 0
    let removedCount = 0
    let tokensSaved = 0

    // Iterate from newest to oldest
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      const messageTokens = estimateSingleMessageTokens(message)

      // Check if we can include this message
      const wouldExceedBudget = totalTokens + messageTokens > availableBudget
      const wouldExceedCount = maxMessages !== undefined && keptMessages.length >= maxMessages

      if (wouldExceedBudget || wouldExceedCount) {
        removedCount++
        tokensSaved += messageTokens
        logger.debug('Removing message from context', {
          messageId: message.id,
          role: message.role,
          tokens: messageTokens,
          reason: wouldExceedBudget ? 'budget' : 'count'
        })
      } else {
        keptMessages.unshift(message) // Prepend to maintain order
        totalTokens += messageTokens
      }
    }

    // Ensure we keep at least the last user message
    if (keptMessages.length === 0 && messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      keptMessages.push(lastMessage)
      removedCount = messages.length - 1
      logger.warn('Kept only the last message to prevent empty context')
    }

    // Ensure conversation starts with a user message (required by most APIs)
    const finalMessages = this.ensureUserMessageFirst(keptMessages)

    logger.info('Sliding window strategy applied', {
      originalCount: messages.length,
      keptCount: finalMessages.length,
      removedCount,
      tokensSaved,
      finalTokens: totalTokens
    })

    return {
      messages: finalMessages,
      messagesRemoved: removedCount,
      tokensSaved,
      wasApplied: removedCount > 0
    }
  }

  /**
   * Ensure the message array starts with a user message
   * Some APIs require conversations to start with user messages
   */
  private ensureUserMessageFirst(messages: Message[]): Message[] {
    if (messages.length === 0) {
      return messages
    }

    // Find the first user message
    const firstUserIndex = messages.findIndex((m) => m.role === 'user')

    if (firstUserIndex <= 0) {
      // Already starts with user message or no user messages
      return messages
    }

    // Remove assistant messages before the first user message
    return messages.slice(firstUserIndex)
  }
}

export default SlidingWindowStrategy
