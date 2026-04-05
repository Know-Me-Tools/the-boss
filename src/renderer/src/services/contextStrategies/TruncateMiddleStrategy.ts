/**
 * Truncate Middle Context Management Strategy
 *
 * This strategy preserves the beginning and end of a conversation while
 * removing messages from the middle. It's based on the "lost in the middle"
 * research finding that LLMs pay most attention to content at the start
 * and end of their context window.
 *
 * How it works:
 * 1. Keep first N messages (initial context, instructions, setup)
 * 2. Keep last M messages (recent context, current task)
 * 3. Remove messages in between
 * 4. Optionally add a marker indicating omission
 *
 * Pros:
 * - Preserves initial instructions and setup context
 * - Maintains most recent conversation state
 * - Simple and predictable behavior
 * - No additional LLM calls required
 *
 * Cons:
 * - Loses potentially important middle context
 * - May cause confusion if middle messages contained critical info
 * - Not suitable for all conversation types
 *
 * Best for:
 * - Task-oriented conversations with clear initial instructions
 * - Coding assistance where initial requirements matter
 * - Support conversations with setup context
 */

import { loggerService } from '@logger'
import { estimateSingleMessageTokens, estimateTextTokens } from '@renderer/services/TokenService'
import type { Message } from '@renderer/types/newMessage'

import type { ContextStrategyConfig, ContextStrategyContext, ContextStrategyResult } from './types'
import { BaseContextStrategy } from './types'

const logger = loggerService.withContext('TruncateMiddleStrategy')

/**
 * Default omission marker text
 */
const DEFAULT_OMISSION_MARKER =
  '[Note: Some earlier messages in this conversation have been omitted to fit within context limits. The initial context and recent messages are preserved.]'

export class TruncateMiddleStrategy extends BaseContextStrategy {
  readonly name = 'truncate_middle' as const
  readonly description = 'Preserves first and last messages, removes middle content to fit within budget'

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

    logger.info('Applying truncate middle strategy', {
      messageCount: messages.length,
      currentTokens: context.currentTokens,
      budget: context.tokenBudget
    })

    // Get configuration with defaults
    const keepFirstMessages = config.keepFirstMessages ?? 2
    const keepLastMessages = config.keepLastMessages ?? 4
    const showOmissionMarker = config.showOmissionMarker ?? true

    // Calculate available budget
    const systemPromptTokens = context.systemPrompt ? estimateTextTokens(context.systemPrompt) : 0
    const omissionMarkerTokens = showOmissionMarker ? estimateTextTokens(DEFAULT_OMISSION_MARKER) : 0
    const availableBudget = context.tokenBudget - systemPromptTokens - omissionMarkerTokens

    // Handle edge cases
    if (messages.length <= keepFirstMessages + keepLastMessages) {
      // Not enough messages to truncate middle, fall back to sliding window
      logger.debug('Not enough messages to truncate middle, using sliding window fallback')
      return this.fallbackToSlidingWindow(messages, config, context)
    }

    // Split messages into three segments
    const firstMessages = messages.slice(0, keepFirstMessages)
    const middleMessages = messages.slice(keepFirstMessages, messages.length - keepLastMessages)
    const lastMessages = messages.slice(messages.length - keepLastMessages)

    // Calculate tokens for each segment
    const firstTokens = this.calculateSegmentTokens(firstMessages)
    const lastTokens = this.calculateSegmentTokens(lastMessages)
    const middleTokens = this.calculateSegmentTokens(middleMessages)

    logger.debug('Segment token breakdown', {
      firstTokens,
      middleTokens,
      lastTokens,
      total: firstTokens + middleTokens + lastTokens
    })

    // Check if first + last fit within budget
    const requiredTokens = firstTokens + lastTokens

    if (requiredTokens > availableBudget) {
      // Even first + last don't fit, need to trim further
      logger.warn('First + last messages exceed budget, applying additional trimming')
      return this.trimWithDynamicBounds(messages, availableBudget, config)
    }

    // First + last fit, we can proceed with middle truncation
    const result = this.buildResult(firstMessages, lastMessages, middleMessages, {
      showOmissionMarker,
      tokensSaved: middleTokens
    })

    logger.info('Truncate middle strategy applied', {
      keptFirst: firstMessages.length,
      keptLast: lastMessages.length,
      removed: middleMessages.length,
      tokensSaved: middleTokens
    })

    return result
  }

  /**
   * Calculate total tokens for a segment of messages
   */
  private calculateSegmentTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => sum + estimateSingleMessageTokens(m), 0)
  }

  /**
   * Build the final result combining first and last messages
   */
  private buildResult(
    firstMessages: Message[],
    lastMessages: Message[],
    removedMessages: Message[],
    options: { showOmissionMarker: boolean; tokensSaved: number }
  ): ContextStrategyResult {
    // Combine first and last messages
    const combinedMessages = [...firstMessages, ...lastMessages]

    // Ensure we start with a user message
    const finalMessages = this.ensureUserMessageFirst(combinedMessages)

    // Generate omission marker if configured
    const summary = options.showOmissionMarker ? DEFAULT_OMISSION_MARKER : undefined

    return {
      messages: finalMessages,
      summary,
      messagesRemoved: removedMessages.length,
      tokensSaved: options.tokensSaved,
      wasApplied: removedMessages.length > 0
    }
  }

  /**
   * Dynamically trim when even first + last exceed budget
   * Reduces both ends proportionally while maintaining minimum context
   */
  private trimWithDynamicBounds(
    messages: Message[],
    availableBudget: number,
    config: ContextStrategyConfig
  ): ContextStrategyResult {
    const showOmissionMarker = config.showOmissionMarker ?? true
    const omissionTokens = showOmissionMarker ? estimateTextTokens(DEFAULT_OMISSION_MARKER) : 0
    const budget = availableBudget - omissionTokens

    // Always keep at least 1 first and 1 last message
    const keptFirst: Message[] = []
    const keptLast: Message[] = []
    let currentTokens = 0

    // Add from end first (most recent context is usually most important)
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      const messageTokens = estimateSingleMessageTokens(message)

      if (currentTokens + messageTokens <= budget * 0.7) {
        // Reserve 70% for recent context
        keptLast.unshift(message)
        currentTokens += messageTokens
      } else {
        break
      }
    }

    // Add from beginning with remaining budget
    for (let i = 0; i < messages.length - keptLast.length; i++) {
      const message = messages[i]
      const messageTokens = estimateSingleMessageTokens(message)

      if (currentTokens + messageTokens <= budget) {
        keptFirst.push(message)
        currentTokens += messageTokens
      } else {
        break
      }
    }

    // Calculate removed messages
    const keptIds = new Set([...keptFirst.map((m) => m.id), ...keptLast.map((m) => m.id)])
    const removedMessages = messages.filter((m) => !keptIds.has(m.id))
    const tokensSaved = this.calculateSegmentTokens(removedMessages)

    return this.buildResult(keptFirst, keptLast, removedMessages, {
      showOmissionMarker,
      tokensSaved
    })
  }

  /**
   * Fallback to sliding window when truncate middle isn't applicable
   */
  private async fallbackToSlidingWindow(
    messages: Message[],
    config: ContextStrategyConfig,
    context: ContextStrategyContext
  ): Promise<ContextStrategyResult> {
    const { SlidingWindowStrategy } = await import('./SlidingWindowStrategy')
    const slidingWindow = new SlidingWindowStrategy()
    return slidingWindow.apply(messages, config, context)
  }

  /**
   * Ensure the message array starts with a user message
   */
  private ensureUserMessageFirst(messages: Message[]): Message[] {
    if (messages.length === 0) {
      return messages
    }

    const firstUserIndex = messages.findIndex((m) => m.role === 'user')

    if (firstUserIndex <= 0) {
      return messages
    }

    return messages.slice(firstUserIndex)
  }
}

export default TruncateMiddleStrategy

// Export the default omission marker for customization
export { DEFAULT_OMISSION_MARKER }
