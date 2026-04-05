/**
 * Progressive Summarization Context Management Strategy
 *
 * This strategy compresses older messages by summarizing them using an LLM.
 * The summary is prepended to the context, preserving key information while
 * dramatically reducing token usage.
 *
 * How it works:
 * 1. Keep recent messages verbatim (short-term memory)
 * 2. Summarize older messages into a condensed form
 * 3. Inject the summary as context for the model
 *
 * Pros:
 * - Preserves important information from older messages
 * - Allows much longer effective conversations
 * - Maintains continuity across long interactions
 *
 * Cons:
 * - Requires additional LLM calls (cost and latency)
 * - Some nuance may be lost in summarization
 * - Summary quality depends on the summarization model
 */

import { loggerService } from '@logger'
import { estimateSingleMessageTokens, estimateTextTokens } from '@renderer/services/TokenService'
import type { Message } from '@renderer/types/newMessage'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'

import type { ContextStrategyConfig, ContextStrategyContext, ContextStrategyResult } from './types'
import { BaseContextStrategy } from './types'

const logger = loggerService.withContext('SummarizationStrategy')

/**
 * Default prompt for summarizing conversation history
 */
const SUMMARIZATION_SYSTEM_PROMPT = `You are a conversation summarizer. Your task is to create a concise summary of the conversation history provided below.

Requirements:
1. Capture the key topics, decisions, and important information discussed
2. Preserve any specific facts, numbers, names, or technical details mentioned
3. Note any ongoing tasks, requests, or unresolved questions
4. Keep the summary factual and objective
5. Use bullet points for clarity when appropriate
6. The summary should be self-contained and understandable without the original conversation

Output only the summary, no additional commentary.`

const SUMMARIZATION_USER_PROMPT = `Please summarize the following conversation history:

{conversation}

Provide a concise summary that captures the essential information.`

export class SummarizationStrategy extends BaseContextStrategy {
  readonly name = 'summarize' as const
  readonly description = 'Progressively summarizes older messages to preserve key information while reducing tokens'

  async apply(
    messages: Message[],
    config: ContextStrategyConfig,
    context: ContextStrategyContext
  ): Promise<ContextStrategyResult> {
    // Check if we need to apply the strategy
    if (!this.shouldApply(context)) {
      logger.debug('Context within budget, no summarization needed', {
        currentTokens: context.currentTokens,
        budget: context.tokenBudget
      })
      return this.noOpResult(messages)
    }

    // Check minimum message threshold
    const summarizeThreshold = config.summarizeThreshold ?? 6
    if (messages.length < summarizeThreshold) {
      logger.debug('Not enough messages to summarize, falling back to sliding window', {
        messageCount: messages.length,
        threshold: summarizeThreshold
      })
      // Fall back to simple truncation for short conversations
      return this.fallbackToSlidingWindow(messages, config, context)
    }

    logger.info('Applying summarization strategy', {
      messageCount: messages.length,
      currentTokens: context.currentTokens,
      budget: context.tokenBudget
    })

    // Calculate how many recent messages to keep verbatim
    const systemPromptTokens = context.systemPrompt ? estimateTextTokens(context.systemPrompt) : 0
    const summaryBudget = config.summaryMaxTokens ?? 500
    const availableForMessages = context.tokenBudget - systemPromptTokens - summaryBudget

    // Find the split point: how many recent messages fit in the budget
    const { recentMessages, messagesToSummarize } = this.splitMessages(messages, availableForMessages)

    if (messagesToSummarize.length === 0) {
      logger.debug('All messages fit in budget after reserving summary space')
      return this.noOpResult(messages)
    }

    // Check if we have an existing summary that covers some messages
    let summary: string

    if (context.existingSummary && this.canReuseExistingSummary(messagesToSummarize, context)) {
      // Extend existing summary with new messages not yet summarized
      const newMessagesToSummarize = this.getNewMessagesToSummarize(messagesToSummarize, context)
      if (newMessagesToSummarize.length > 0) {
        summary = await this.extendSummary(context.existingSummary, newMessagesToSummarize, config, context)
      } else {
        summary = context.existingSummary
      }
    } else {
      // Generate new summary
      summary = await this.generateSummary(messagesToSummarize, config, context)
    }

    // Calculate tokens saved
    const originalTokens = messagesToSummarize.reduce((sum, m) => sum + estimateSingleMessageTokens(m), 0)
    const summaryTokens = estimateTextTokens(summary)
    const tokensSaved = originalTokens - summaryTokens

    logger.info('Summarization complete', {
      summarizedCount: messagesToSummarize.length,
      recentCount: recentMessages.length,
      originalTokens,
      summaryTokens,
      tokensSaved
    })

    // Ensure conversation starts with a user message
    const finalMessages = this.ensureUserMessageFirst(recentMessages)

    return {
      messages: finalMessages,
      summary,
      messagesRemoved: messagesToSummarize.length,
      tokensSaved,
      wasApplied: true
    }
  }

  /**
   * Split messages into those to summarize and those to keep verbatim
   */
  private splitMessages(
    messages: Message[],
    availableBudget: number
  ): {
    recentMessages: Message[]
    messagesToSummarize: Message[]
  } {
    const recentMessages: Message[] = []
    let recentTokens = 0

    // Work backwards from most recent, keeping messages that fit
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      const tokens = estimateSingleMessageTokens(message)

      if (recentTokens + tokens <= availableBudget) {
        recentMessages.unshift(message)
        recentTokens += tokens
      } else {
        // Everything before this point needs to be summarized
        break
      }
    }

    // Messages to summarize are everything not in recentMessages
    const recentIds = new Set(recentMessages.map((m) => m.id))
    const messagesToSummarize = messages.filter((m) => !recentIds.has(m.id))

    return { recentMessages, messagesToSummarize }
  }

  /**
   * Generate a summary of the given messages
   */
  private async generateSummary(
    messages: Message[],
    _config: ContextStrategyConfig,
    _context: ContextStrategyContext
  ): Promise<string> {
    // Format messages for summarization
    const conversationText = this.formatMessagesForSummary(messages)

    // For now, we'll use a simple extractive approach
    // TODO: In a future iteration, this could call an actual LLM
    // using the configured summarization model

    logger.debug('Generating summary for messages', {
      messageCount: messages.length,
      textLength: conversationText.length
    })

    // Simple extractive summary as fallback
    // This extracts key sentences and combines them
    return this.createExtractiveSimpleSummary(messages)
  }

  /**
   * Extend an existing summary with new messages
   */
  private async extendSummary(
    existingSummary: string,
    newMessages: Message[],
    config: ContextStrategyConfig,
    context: ContextStrategyContext
  ): Promise<string> {
    // Generate summary of new messages
    const newSummary = await this.generateSummary(newMessages, config, context)

    // Combine summaries
    return `${existingSummary}\n\n[Additional context:]\n${newSummary}`
  }

  /**
   * Format messages into a text representation for summarization
   */
  private formatMessagesForSummary(messages: Message[]): string {
    return messages
      .map((m) => {
        const content = getMainTextContent(m)
        const role = m.role === 'user' ? 'User' : 'Assistant'
        return `${role}: ${content}`
      })
      .join('\n\n')
  }

  /**
   * Create a simple extractive summary without LLM
   * This is a fallback that extracts key parts of messages
   */
  private createExtractiveSimpleSummary(messages: Message[]): string {
    const summaryParts: string[] = []
    const maxCharsPerMessage = 200 // Limit characters per message in summary

    summaryParts.push('[Conversation Summary]')

    for (const message of messages) {
      const content = getMainTextContent(message)
      const role = message.role === 'user' ? 'User' : 'Assistant'

      if (content.length <= maxCharsPerMessage) {
        summaryParts.push(`- ${role}: ${content}`)
      } else {
        // Extract first part and indicate truncation
        const truncated = content.substring(0, maxCharsPerMessage).trim()
        const lastSpace = truncated.lastIndexOf(' ')
        const cleanTruncated = lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated
        summaryParts.push(`- ${role}: ${cleanTruncated}...`)
      }
    }

    return summaryParts.join('\n')
  }

  /**
   * Check if we can reuse the existing summary
   */
  private canReuseExistingSummary(_messagesToSummarize: Message[], context: ContextStrategyContext): boolean {
    if (!context.existingSummary) {
      return false
    }

    // Check if the topic matches (if available)
    // The existing summary is valid if it covers some of the messages we need to summarize
    return true // Simplified check - in production, would compare message IDs
  }

  /**
   * Get messages that are not yet covered by the existing summary
   */
  private getNewMessagesToSummarize(messagesToSummarize: Message[], context: ContextStrategyContext): Message[] {
    // If we don't track which messages are summarized, summarize all
    // In production, this would check against stored message IDs
    if (!context.existingSummary) {
      return messagesToSummarize
    }

    // For now, return an empty array if we have an existing summary
    // A more sophisticated implementation would track which messages are new
    return []
  }

  /**
   * Fallback to sliding window when we can't summarize
   */
  private async fallbackToSlidingWindow(
    messages: Message[],
    config: ContextStrategyConfig,
    context: ContextStrategyContext
  ): Promise<ContextStrategyResult> {
    // Import dynamically to avoid circular dependency
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

export default SummarizationStrategy

// Export the prompts for potential customization
export { SUMMARIZATION_SYSTEM_PROMPT, SUMMARIZATION_USER_PROMPT }
