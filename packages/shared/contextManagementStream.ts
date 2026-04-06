/**
 * Stream / UI payload when context management alters what the model sees (assistant chat or agent SDK).
 * Kept in `packages/shared` so main and renderer agree on shape.
 */
export type ContextManagementSurface = 'assistant' | 'agent'

export type ContextManagementTrigger = 'chat_pipeline' | 'sdk_compact_pre_turn' | 'sdk_compact_interactive'

export interface ContextManagementStreamPayload {
  surface: ContextManagementSurface
  /** e.g. sliding_window, summarize — strategy key from settings */
  strategyType: string
  /** Assistant: messages before / after pipeline */
  originalMessageCount?: number
  finalMessageCount?: number
  messagesRemoved?: number
  /** Estimated tokens saved (assistant) or approximate delta (agent) */
  tokensSaved?: number
  tokensBefore?: number
  tokensAfter?: number
  /** Truncated excerpt only — never full prompts by default */
  summaryPreview?: string
  /** Single human-readable sentence for the card */
  alterationSummary: string
  trigger: ContextManagementTrigger
}
