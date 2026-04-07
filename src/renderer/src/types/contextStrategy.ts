/**
 * Context Management Strategy Types
 *
 * This module defines the types and interfaces for context window management strategies.
 * These strategies help prevent "Prompt is too long" errors by intelligently managing
 * conversation history to stay within model context limits.
 */

import * as z from 'zod'

import type { Model } from './index'
import type { Message } from './newMessage'

/**
 * Available context management strategy types
 */
export type ContextStrategyType =
  | 'none' // No management - use current behavior (may exceed limits)
  | 'sliding_window' // Keep only the most recent messages within token budget
  | 'summarize' // Progressive summarization of older messages
  | 'hierarchical' // 3-tier memory: short-term, mid-term, long-term
  | 'truncate_middle' // Keep first + last messages, remove middle

/**
 * Configuration options for context management strategies
 */
export interface ContextStrategyConfig {
  /**
   * The strategy type to use
   * @default 'sliding_window'
   */
  type: ContextStrategyType

  // ==================== Sliding Window Options ====================

  /**
   * Maximum number of messages to keep in sliding window mode
   * If not set, determined dynamically by token budget
   */
  maxMessages?: number

  // ==================== Summarization Options ====================

  /**
   * Model ID to use for generating summaries
   * If not set, uses the quick model setting or falls back to current model
   */
  summarizationModelId?: string

  /**
   * Maximum tokens allowed for each summary block
   * @default 500
   */
  summaryMaxTokens?: number

  /**
   * Minimum messages before triggering summarization
   * Prevents summarizing very short conversations
   * @default 6
   */
  summarizeThreshold?: number

  // ==================== Hierarchical Memory Options ====================

  /**
   * Number of recent turns to keep verbatim in short-term memory
   * @default 5
   */
  shortTermTurns?: number

  /**
   * Token budget allocated for mid-term memory summaries
   * @default 2000
   */
  midTermSummaryTokens?: number

  /**
   * Token budget allocated for long-term facts/preferences
   * @default 500
   */
  longTermFactsTokens?: number

  // ==================== Truncate Middle Options ====================

  /**
   * Number of initial messages to preserve (system context, initial instructions)
   * @default 2
   */
  keepFirstMessages?: number

  /**
   * Number of recent messages to preserve
   * @default 4
   */
  keepLastMessages?: number

  /**
   * Whether to add a marker indicating messages were omitted
   * @default true
   */
  showOmissionMarker?: boolean

  /**
   * Agent sessions only: when the last known total token count (from the prior turn’s
   * finish usage) exceeds this value, the app may run an SDK `/compact` step before
   * sending the next user message. Requires an active resumed SDK session.
   */
  compactTriggerTokens?: number
}

/**
 * Zod schema for persisting context strategy on agent/session `configuration` JSON.
 */
export const ContextStrategyConfigSchema = z.object({
  type: z.enum(['none', 'sliding_window', 'summarize', 'hierarchical', 'truncate_middle']),
  maxMessages: z.number().optional(),
  summarizationModelId: z.string().optional(),
  summaryMaxTokens: z.number().optional(),
  summarizeThreshold: z.number().optional(),
  shortTermTurns: z.number().optional(),
  midTermSummaryTokens: z.number().optional(),
  longTermFactsTokens: z.number().optional(),
  keepFirstMessages: z.number().optional(),
  keepLastMessages: z.number().optional(),
  showOmissionMarker: z.boolean().optional(),
  compactTriggerTokens: z.number().optional()
})

/**
 * Default configuration for context strategies
 */
/**
 * Default for **assistant/chat** context strategies (existing behavior).
 */
export const DEFAULT_CONTEXT_STRATEGY_CONFIG: ContextStrategyConfig = {
  type: 'sliding_window',
  // Sliding window defaults
  maxMessages: undefined, // Dynamic based on token budget
  // Summarization defaults
  summarizationModelId: undefined, // Use quick model
  summaryMaxTokens: 500,
  summarizeThreshold: 6,
  // Hierarchical defaults
  shortTermTurns: 5,
  midTermSummaryTokens: 2000,
  longTermFactsTokens: 500,
  // Truncate middle defaults
  keepFirstMessages: 2,
  keepLastMessages: 4,
  showOmissionMarker: true
}

/**
 * Default for **agent** context strategies: disabled unless the user opts in.
 */
export const DEFAULT_AGENT_CONTEXT_STRATEGY_CONFIG: ContextStrategyConfig = {
  type: 'none'
}

/**
 * Result of applying a context strategy
 */
export interface ContextStrategyResult {
  /**
   * The processed messages after applying the strategy
   */
  messages: Message[]

  /**
   * Summary text generated (for summarization strategies)
   */
  summary?: string

  /**
   * Number of messages removed/summarized
   */
  messagesRemoved: number

  /**
   * Estimated tokens saved by the strategy
   */
  tokensSaved: number

  /**
   * Whether the strategy was applied (false if context was already within limits)
   */
  wasApplied: boolean

  /**
   * Long-term facts extracted (for hierarchical strategy)
   */
  extractedFacts?: string[]
}

/**
 * Context for strategy execution
 */
export interface ContextStrategyContext {
  /**
   * The model being used for the conversation
   */
  model: Model

  /**
   * Available token budget for the conversation
   */
  tokenBudget: number

  /**
   * Current estimated token usage
   */
  currentTokens: number

  /**
   * Token overhead from tool definitions (MCP tools, etc.)
   * These are subtracted from the available budget before strategy application.
   */
  toolTokens?: number

  /**
   * Token overhead from knowledge base (RAG) content
   * These are subtracted from the available budget before strategy application.
   */
  knowledgeTokens?: number

  /**
   * System prompt to include in calculations
   */
  systemPrompt?: string

  /**
   * Topic ID for caching/storage purposes
   */
  topicId?: string

  /**
   * Existing summary from previous context management
   */
  existingSummary?: string

  /**
   * Existing long-term facts from hierarchical memory
   */
  existingFacts?: string[]
}

/**
 * Interface for context strategy implementations
 */
export interface ContextStrategy {
  /**
   * Unique identifier for this strategy
   */
  readonly name: ContextStrategyType

  /**
   * Human-readable description of the strategy
   */
  readonly description: string

  /**
   * Apply the context management strategy to messages
   *
   * @param messages - The messages to process
   * @param config - Strategy configuration
   * @param context - Execution context with model and token info
   * @returns Promise resolving to the strategy result
   */
  apply(
    messages: Message[],
    config: ContextStrategyConfig,
    context: ContextStrategyContext
  ): Promise<ContextStrategyResult>
}

/**
 * Metadata stored with a topic for context management persistence
 */
export interface TopicContextMetadata {
  /**
   * Last generated summary of conversation history
   */
  conversationSummary?: string

  /**
   * Timestamp when summary was last updated
   */
  summaryUpdatedAt?: string

  /**
   * IDs of messages included in the current summary
   */
  summarizedMessageIds?: string[]

  /**
   * Extracted long-term facts/preferences for hierarchical memory
   */
  longTermFacts?: string[]

  /**
   * Last time facts were extracted/updated
   */
  factsUpdatedAt?: string
}

/**
 * Labels for context strategy types (for UI display)
 */
export const CONTEXT_STRATEGY_LABELS: Record<ContextStrategyType, string> = {
  none: 'None (No Management)',
  sliding_window: 'Sliding Window',
  summarize: 'Progressive Summarization',
  hierarchical: 'Hierarchical Memory',
  truncate_middle: 'Keep First & Last'
}

/**
 * Descriptions for context strategy types (for UI tooltips)
 */
export const CONTEXT_STRATEGY_DESCRIPTIONS: Record<ContextStrategyType, string> = {
  none: 'No context management. May exceed model limits on long conversations.',
  sliding_window: 'Keeps only the most recent messages within the token budget. Simple and predictable.',
  summarize:
    'Progressively summarizes older messages to preserve key information while reducing tokens. Uses an LLM to generate summaries.',
  hierarchical:
    'Three-tier memory system: recent messages verbatim, older messages summarized, key facts extracted. Best for long-running conversations.',
  truncate_middle:
    'Preserves initial instructions and recent context, removes middle messages. Good when initial setup is important.'
}
