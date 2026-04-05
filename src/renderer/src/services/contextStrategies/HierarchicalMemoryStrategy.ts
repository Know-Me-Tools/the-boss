/**
 * Hierarchical Memory Context Management Strategy
 *
 * This strategy implements a three-tier memory system inspired by human memory:
 *
 * 1. Short-term Memory (STM): Recent conversation turns kept verbatim
 *    - Highest fidelity, most recent context
 *    - Configurable number of turns (default: 5)
 *
 * 2. Mid-term Memory (MTM): Summarized sessions from earlier in conversation
 *    - Compressed representation of older exchanges
 *    - Preserves key topics and decisions
 *
 * 3. Long-term Memory (LTM): Extracted key facts and preferences
 *    - Persistent facts: names, preferences, important decisions
 *    - Carried across the entire conversation
 *
 * Pros:
 * - Best information preservation across long conversations
 * - Mimics natural human memory patterns
 * - Balances recency with important historical context
 *
 * Cons:
 * - Most complex to implement
 * - Requires careful tuning of tier sizes
 * - May require LLM calls for summarization/extraction
 */

import { loggerService } from '@logger'
import { estimateSingleMessageTokens, estimateTextTokens } from '@renderer/services/TokenService'
import type { Message } from '@renderer/types/newMessage'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'

import type { ContextStrategyConfig, ContextStrategyContext, ContextStrategyResult } from './types'
import { BaseContextStrategy } from './types'

const logger = loggerService.withContext('HierarchicalMemoryStrategy')

/**
 * Structure for the three memory tiers
 */
interface MemoryTiers {
  shortTerm: Message[]
  midTermSummary: string
  longTermFacts: string[]
}

export class HierarchicalMemoryStrategy extends BaseContextStrategy {
  readonly name = 'hierarchical' as const
  readonly description = 'Three-tier memory system: short-term (verbatim), mid-term (summaries), long-term (facts)'

  async apply(
    messages: Message[],
    config: ContextStrategyConfig,
    context: ContextStrategyContext
  ): Promise<ContextStrategyResult> {
    // Check if we need to apply the strategy
    if (!this.shouldApply(context)) {
      logger.debug('Context within budget, no hierarchical management needed', {
        currentTokens: context.currentTokens,
        budget: context.tokenBudget
      })
      return this.noOpResult(messages)
    }

    logger.info('Applying hierarchical memory strategy', {
      messageCount: messages.length,
      currentTokens: context.currentTokens,
      budget: context.tokenBudget
    })

    // Get configuration with defaults
    const shortTermTurns = config.shortTermTurns ?? 5
    const midTermBudget = config.midTermSummaryTokens ?? 2000
    const longTermBudget = config.longTermFactsTokens ?? 500

    // Calculate available budget after system prompt
    const systemPromptTokens = context.systemPrompt ? estimateTextTokens(context.systemPrompt) : 0
    const availableBudget = context.tokenBudget - systemPromptTokens

    // Build the three tiers
    const tiers = await this.buildMemoryTiers(messages, {
      shortTermTurns,
      midTermBudget,
      longTermBudget,
      availableBudget,
      existingFacts: context.existingFacts,
      existingSummary: context.existingSummary
    })

    // Calculate what was removed/compressed
    const shortTermTokens = tiers.shortTerm.reduce((sum, m) => sum + estimateSingleMessageTokens(m), 0)
    const midTermTokens = estimateTextTokens(tiers.midTermSummary)
    const longTermTokens = tiers.longTermFacts.reduce((sum, f) => sum + estimateTextTokens(f), 0)

    const originalTokens = context.currentTokens - systemPromptTokens
    const newTokens = shortTermTokens + midTermTokens + longTermTokens
    const tokensSaved = originalTokens - newTokens
    const messagesRemoved = messages.length - tiers.shortTerm.length

    logger.info('Hierarchical memory strategy applied', {
      shortTermMessages: tiers.shortTerm.length,
      midTermTokens,
      longTermFacts: tiers.longTermFacts.length,
      tokensSaved,
      messagesRemoved
    })

    // Build combined summary for the context
    const combinedSummary = this.buildCombinedContext(tiers)

    // Ensure conversation starts with a user message
    const finalMessages = this.ensureUserMessageFirst(tiers.shortTerm)

    return {
      messages: finalMessages,
      summary: combinedSummary,
      messagesRemoved,
      tokensSaved,
      wasApplied: messagesRemoved > 0 || tiers.midTermSummary.length > 0,
      extractedFacts: tiers.longTermFacts
    }
  }

  /**
   * Build the three memory tiers from messages
   */
  private async buildMemoryTiers(
    messages: Message[],
    options: {
      shortTermTurns: number
      midTermBudget: number
      longTermBudget: number
      availableBudget: number
      existingFacts?: string[]
      existingSummary?: string
    }
  ): Promise<MemoryTiers> {
    const { shortTermTurns, midTermBudget, longTermBudget, availableBudget, existingFacts, existingSummary } = options

    // 1. Short-term: Keep most recent turns
    // A "turn" is typically a user-assistant pair, but we'll count individual messages
    const shortTermCount = Math.min(shortTermTurns * 2, messages.length) // *2 for user+assistant
    const shortTerm = messages.slice(-shortTermCount)

    // Calculate short-term tokens
    const shortTermTokens = shortTerm.reduce((sum, m) => sum + estimateSingleMessageTokens(m), 0)

    // 2. Mid-term: Summarize messages between short-term and the beginning
    const midTermMessages = messages.slice(0, messages.length - shortTermCount)
    let midTermSummary = ''

    if (midTermMessages.length > 0) {
      // Check if we can reuse existing summary
      if (existingSummary && this.canReuseExistingSummary(midTermMessages)) {
        midTermSummary = existingSummary
      } else {
        midTermSummary = this.createMidTermSummary(midTermMessages, midTermBudget)
      }
    }

    // 3. Long-term: Extract or reuse facts
    let longTermFacts = existingFacts || []

    // If we don't have existing facts, extract them from all messages
    if (longTermFacts.length === 0) {
      longTermFacts = this.extractLongTermFacts(messages, longTermBudget)
    } else {
      // Check if new facts should be extracted from recent messages
      const newFacts = this.extractLongTermFacts(shortTerm, Math.floor(longTermBudget / 2))
      longTermFacts = this.mergeFacts(longTermFacts, newFacts, longTermBudget)
    }

    // Verify we're within budget, trim if necessary
    const totalTokens =
      shortTermTokens +
      estimateTextTokens(midTermSummary) +
      longTermFacts.reduce((sum, f) => sum + estimateTextTokens(f), 0)

    if (totalTokens > availableBudget) {
      // Trim mid-term summary first, then long-term facts if needed
      const targetMidTermTokens = Math.max(0, midTermBudget - (totalTokens - availableBudget))
      midTermSummary = this.trimToTokenBudget(midTermSummary, targetMidTermTokens)
    }

    return {
      shortTerm,
      midTermSummary,
      longTermFacts
    }
  }

  /**
   * Create a mid-term summary from messages
   */
  private createMidTermSummary(messages: Message[], maxTokens: number): string {
    if (messages.length === 0) {
      return ''
    }

    const summaryParts: string[] = []
    summaryParts.push('[Previous Conversation Summary]')

    // Group messages by rough topic/exchange
    let currentTokens = estimateTextTokens('[Previous Conversation Summary]\n')

    for (const message of messages) {
      const content = getMainTextContent(message)
      const role = message.role === 'user' ? 'User' : 'Assistant'

      // Create a condensed version
      const condensed = this.condenseMessage(content, 150)
      const entry = `- ${role}: ${condensed}`
      const entryTokens = estimateTextTokens(entry + '\n')

      if (currentTokens + entryTokens <= maxTokens) {
        summaryParts.push(entry)
        currentTokens += entryTokens
      } else {
        // Budget exhausted, add ellipsis and stop
        summaryParts.push('- [Earlier messages omitted...]')
        break
      }
    }

    return summaryParts.join('\n')
  }

  /**
   * Extract long-term facts from messages
   */
  private extractLongTermFacts(messages: Message[], maxTokens: number): string[] {
    const facts: string[] = []
    let currentTokens = 0

    // Simple extraction: look for statements that might be important facts
    // In a production system, this would use an LLM for better extraction
    const factPatterns = [
      /my name is (\w+)/i,
      /i(?:'m| am) (?:a |an )?(\w+)/i, // Profession/role
      /i prefer (\w+)/i,
      /i like (\w+)/i,
      /i(?:'m| am) working on (.+?)(?:\.|,|$)/i,
      /the project is called (.+?)(?:\.|,|$)/i,
      /we decided to (.+?)(?:\.|,|$)/i,
      /the goal is (.+?)(?:\.|,|$)/i
    ]

    for (const message of messages) {
      if (message.role !== 'user') continue

      const content = getMainTextContent(message)

      for (const pattern of factPatterns) {
        const match = content.match(pattern)
        if (match) {
          const fact = match[0]
          const factTokens = estimateTextTokens(fact)

          if (currentTokens + factTokens <= maxTokens && !facts.includes(fact)) {
            facts.push(fact)
            currentTokens += factTokens
          }
        }
      }
    }

    return facts
  }

  /**
   * Merge new facts with existing facts within budget
   */
  private mergeFacts(existing: string[], newFacts: string[], maxTokens: number): string[] {
    const merged = [...existing]
    let currentTokens = existing.reduce((sum, f) => sum + estimateTextTokens(f), 0)

    for (const fact of newFacts) {
      const factTokens = estimateTextTokens(fact)

      // Check for duplicates or similar facts
      const isDuplicate = existing.some(
        (e) => e.toLowerCase().includes(fact.toLowerCase()) || fact.toLowerCase().includes(e.toLowerCase())
      )

      if (!isDuplicate && currentTokens + factTokens <= maxTokens) {
        merged.push(fact)
        currentTokens += factTokens
      }
    }

    return merged
  }

  /**
   * Build combined context from all tiers
   */
  private buildCombinedContext(tiers: MemoryTiers): string {
    const parts: string[] = []

    // Add long-term facts first (most persistent context)
    if (tiers.longTermFacts.length > 0) {
      parts.push('[Key Facts & Preferences]')
      parts.push(tiers.longTermFacts.map((f) => `• ${f}`).join('\n'))
      parts.push('')
    }

    // Add mid-term summary
    if (tiers.midTermSummary) {
      parts.push(tiers.midTermSummary)
      parts.push('')
    }

    return parts.join('\n').trim()
  }

  /**
   * Condense a message to a maximum character length
   */
  private condenseMessage(content: string, maxChars: number): string {
    if (content.length <= maxChars) {
      return content
    }

    // Try to cut at a sentence boundary
    const truncated = content.substring(0, maxChars)
    const lastPeriod = truncated.lastIndexOf('.')
    const lastQuestion = truncated.lastIndexOf('?')
    const lastExclamation = truncated.lastIndexOf('!')

    const lastSentenceEnd = Math.max(lastPeriod, lastQuestion, lastExclamation)

    if (lastSentenceEnd > maxChars * 0.5) {
      return truncated.substring(0, lastSentenceEnd + 1)
    }

    // Fall back to word boundary
    const lastSpace = truncated.lastIndexOf(' ')
    if (lastSpace > 0) {
      return truncated.substring(0, lastSpace) + '...'
    }

    return truncated + '...'
  }

  /**
   * Trim text to fit within token budget
   */
  private trimToTokenBudget(text: string, maxTokens: number): string {
    if (estimateTextTokens(text) <= maxTokens) {
      return text
    }

    // Binary search to find the right length
    let low = 0
    let high = text.length

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2)
      const trimmed = text.substring(0, mid)

      if (estimateTextTokens(trimmed) <= maxTokens) {
        low = mid
      } else {
        high = mid - 1
      }
    }

    const result = text.substring(0, low)

    // Try to end at a word boundary
    const lastSpace = result.lastIndexOf(' ')
    if (lastSpace > result.length * 0.8) {
      return result.substring(0, lastSpace) + '...'
    }

    return result + '...'
  }

  /**
   * Check if existing summary can be reused
   */
  private canReuseExistingSummary(_messages: Message[]): boolean {
    // In production, this would check if the messages match what was summarized
    // For now, return false to always regenerate
    return false
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

export default HierarchicalMemoryStrategy
