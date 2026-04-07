import { DEFAULT_CONTEXTCOUNT, MAX_CONTEXT_COUNT, UNLIMITED_CONTEXT_COUNT } from '@renderer/config/constant'
import type { Assistant, Topic } from '@renderer/types'
import type { ContextStrategyConfig } from '@renderer/types/contextStrategy'
import { DEFAULT_CONTEXT_STRATEGY_CONFIG } from '@renderer/types/contextStrategy'
import type { Message } from '@renderer/types/newMessage'
import {
  filterAdjacentUserMessaegs,
  filterAfterContextClearMessages,
  filterEmptyMessages,
  filterErrorOnlyMessagesWithRelated,
  filterUsefulMessages,
  filterUserRoleStartMessages
} from '@renderer/utils/messageUtils/filters'
import { filterLastAssistantMessage } from '@renderer/utils/messageUtils/filters'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import type { ContextManagementStreamPayload } from '@shared/contextManagementStream'

const CONTEXT_STRATEGY_KEYS: Array<keyof ContextStrategyConfig> = [
  'type',
  'maxMessages',
  'summarizationModelId',
  'summaryMaxTokens',
  'summarizeThreshold',
  'shortTermTurns',
  'midTermSummaryTokens',
  'longTermFactsTokens',
  'keepFirstMessages',
  'keepLastMessages',
  'showOmissionMarker',
  'compactTriggerTokens'
]

function isAssistantLike(value: unknown): value is Assistant {
  return typeof value === 'object' && value !== null && 'settings' in value
}

function isTopicLike(value: unknown): value is Topic {
  return typeof value === 'object' && value !== null && 'assistantId' in value
}

function takeLastMessages(messages: Message[], count: number): Message[] {
  if (count === UNLIMITED_CONTEXT_COUNT || count >= messages.length) {
    return [...messages]
  }

  if (count <= 0) {
    return []
  }

  return messages.slice(-count)
}

function estimateMessagesTokenCount(messages: Message[]): number {
  const text = messages
    .map((message) => getMainTextContent(message))
    .filter(Boolean)
    .join('\n\n')

  if (!text) {
    return 0
  }

  return Math.ceil(text.length / 4)
}

function haveDifferentMessageWindows(a: Message[], b: Message[]): boolean {
  if (a.length !== b.length) {
    return true
  }

  return a.some((message, index) => message.id !== b[index]?.id)
}

function buildAssistantContextTelemetry(
  originalMessages: Message[],
  finalMessages: Message[],
  strategy: ContextStrategyConfig
): ContextManagementStreamPayload | undefined {
  if (!haveDifferentMessageWindows(originalMessages, finalMessages)) {
    return undefined
  }

  const tokensBefore = estimateMessagesTokenCount(originalMessages)
  const tokensAfter = estimateMessagesTokenCount(finalMessages)

  return {
    surface: 'assistant',
    strategyType: strategy.type,
    originalMessageCount: originalMessages.length,
    finalMessageCount: finalMessages.length,
    messagesRemoved: Math.max(0, originalMessages.length - finalMessages.length),
    tokensBefore,
    tokensAfter,
    tokensSaved: Math.max(0, tokensBefore - tokensAfter),
    alterationSummary: `Chat context strategy "${strategy.type}" changed the messages sent to the model.`,
    trigger: 'chat_pipeline'
  }
}

export function normalizeContextStrategy(
  config?: Partial<ContextStrategyConfig> | ContextStrategyConfig | null
): ContextStrategyConfig {
  return {
    ...DEFAULT_CONTEXT_STRATEGY_CONFIG,
    ...config
  }
}

export function hasContextStrategyOverride(
  config?: Partial<ContextStrategyConfig> | ContextStrategyConfig | null
): boolean {
  if (!config) {
    return false
  }

  return CONTEXT_STRATEGY_KEYS.some((key) => config[key] !== undefined)
}

export function deriveContextStrategyOverride(
  base: Partial<ContextStrategyConfig> | ContextStrategyConfig,
  next: Partial<ContextStrategyConfig> | ContextStrategyConfig
): Partial<ContextStrategyConfig> | undefined {
  const normalizedBase = normalizeContextStrategy(base)
  const normalizedNext = normalizeContextStrategy(next)
  const override: Partial<ContextStrategyConfig> = {}

  for (const key of CONTEXT_STRATEGY_KEYS) {
    if (normalizedBase[key] !== normalizedNext[key]) {
      ;(override as any)[key] = normalizedNext[key]
    }
  }

  return hasContextStrategyOverride(override) ? override : undefined
}

export function resolveEffectiveChatContextStrategy({
  globalStrategy,
  assistant,
  topic
}: {
  globalStrategy: Partial<ContextStrategyConfig> | ContextStrategyConfig
  assistant?: Assistant | Partial<ContextStrategyConfig> | null
  topic?: Topic | Partial<ContextStrategyConfig> | null
}): ContextStrategyConfig {
  const assistantStrategy = isAssistantLike(assistant) ? assistant.settings?.contextStrategy : assistant
  const topicStrategy = isTopicLike(topic) ? topic.contextStrategy : topic

  return normalizeContextStrategy({
    ...normalizeContextStrategy(globalStrategy),
    ...assistantStrategy,
    ...topicStrategy
  })
}

export function getLegacyContextCount(assistant: Assistant): number {
  const rawContextCount = assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT
  return rawContextCount === MAX_CONTEXT_COUNT ? UNLIMITED_CONTEXT_COUNT : rawContextCount
}

export function findTopicForConversation(
  assistant: Assistant,
  topicOrId?: string | Topic | null,
  messages?: Message[]
): Topic | undefined {
  if (typeof topicOrId === 'object' && topicOrId) {
    return topicOrId
  }

  const topicId = topicOrId ?? messages?.findLast((message) => !!message.topicId)?.topicId
  if (!topicId) {
    return undefined
  }

  return assistant.topics.find((topic) => topic.id === topicId)
}

export function applyChatContextStrategy(
  messages: Message[],
  {
    strategy,
    legacyContextCount
  }: {
    strategy: ContextStrategyConfig
    legacyContextCount: number
  }
): Message[] {
  switch (strategy.type) {
    case 'sliding_window': {
      const maxMessages = strategy.maxMessages ?? legacyContextCount
      return takeLastMessages(messages, maxMessages)
    }
    case 'truncate_middle': {
      const keepFirstMessages = strategy.keepFirstMessages ?? DEFAULT_CONTEXT_STRATEGY_CONFIG.keepFirstMessages ?? 2
      const keepLastMessages = strategy.keepLastMessages ?? DEFAULT_CONTEXT_STRATEGY_CONFIG.keepLastMessages ?? 4
      const maxMessages = keepFirstMessages + keepLastMessages

      if (maxMessages >= messages.length) {
        return [...messages]
      }

      return [...messages.slice(0, keepFirstMessages), ...messages.slice(-keepLastMessages)]
    }
    case 'summarize':
    case 'hierarchical':
    case 'none':
    default:
      return takeLastMessages(messages, legacyContextCount)
  }
}

export function filterConversationMessagesForContext(
  messages: Message[],
  assistant: Assistant,
  globalStrategy: Partial<ContextStrategyConfig> | ContextStrategyConfig,
  topicOrId?: string | Topic | null
): { messages: Message[]; strategy: ContextStrategyConfig; topic?: Topic; telemetry?: ContextManagementStreamPayload } {
  const topic = findTopicForConversation(assistant, topicOrId, messages)
  const strategy = resolveEffectiveChatContextStrategy({ globalStrategy, assistant, topic })
  const legacyContextCount = getLegacyContextCount(assistant)

  const messagesAfterContextClear = filterAfterContextClearMessages(messages)
  const usefulMessages = filterUsefulMessages(messagesAfterContextClear)
  const withoutErrorOnlyPairs = filterErrorOnlyMessagesWithRelated(usefulMessages)
  const withoutTrailingAssistant = filterLastAssistantMessage(withoutErrorOnlyPairs)
  const withoutAdjacentUsers = filterAdjacentUserMessaegs(withoutTrailingAssistant)
  const strategyFiltered = applyChatContextStrategy(withoutAdjacentUsers, {
    strategy,
    legacyContextCount:
      legacyContextCount === UNLIMITED_CONTEXT_COUNT ? UNLIMITED_CONTEXT_COUNT : legacyContextCount + 2
  })
  const contextClearFiltered = filterAfterContextClearMessages(strategyFiltered)
  const nonEmptyMessages = filterEmptyMessages(contextClearFiltered)
  const userRoleStartMessages = filterUserRoleStartMessages(nonEmptyMessages)

  return {
    messages: userRoleStartMessages,
    strategy,
    topic,
    telemetry: buildAssistantContextTelemetry(withoutAdjacentUsers, userRoleStartMessages, strategy)
  }
}

export function getContextWindowInfo(
  assistant: Assistant,
  messages: Message[],
  globalStrategy: Partial<ContextStrategyConfig> | ContextStrategyConfig,
  topicOrId?: string | Topic | null
): { current: number; max: number } {
  const effectiveMessages = filterConversationMessagesForContext(
    messages,
    assistant,
    globalStrategy,
    topicOrId
  ).messages
  const strategy = resolveEffectiveChatContextStrategy({
    globalStrategy,
    assistant,
    topic: findTopicForConversation(assistant, topicOrId, messages)
  })
  const legacyContextCount = getLegacyContextCount(assistant)

  switch (strategy.type) {
    case 'sliding_window':
      return {
        current: effectiveMessages.length,
        max: strategy.maxMessages ?? legacyContextCount
      }
    case 'truncate_middle':
      return {
        current: effectiveMessages.length,
        max:
          (strategy.keepFirstMessages ?? DEFAULT_CONTEXT_STRATEGY_CONFIG.keepFirstMessages ?? 2) +
          (strategy.keepLastMessages ?? DEFAULT_CONTEXT_STRATEGY_CONFIG.keepLastMessages ?? 4)
      }
    default:
      return {
        current: effectiveMessages.length,
        max: legacyContextCount === UNLIMITED_CONTEXT_COUNT ? MAX_CONTEXT_COUNT : legacyContextCount
      }
  }
}
