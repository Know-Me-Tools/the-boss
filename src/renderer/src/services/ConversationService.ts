import { loggerService } from '@logger'
import { convertMessagesToSdkMessages } from '@renderer/aiCore/prepareParams'
import type { Assistant, Message, Topic } from '@renderer/types'
import type { ContextStrategyType } from '@renderer/types/contextStrategy'
import { filterAdjacentUserMessaegs, filterLastAssistantMessage } from '@renderer/utils/messageUtils/filters'
import type { ModelMessage } from 'ai'
import { findLast, isEmpty, takeRight } from 'lodash'

import { getAssistantSettings, getDefaultModel } from './AssistantService'
import { applyContextStrategy, getEffectiveStrategyConfig, isContextStrategyEnabled } from './contextStrategies'
import {
  filterAfterContextClearMessages,
  filterEmptyMessages,
  filterErrorOnlyMessagesWithRelated,
  filterUsefulMessages,
  filterUserRoleStartMessages
} from './MessagesService'

const logger = loggerService.withContext('ConversationService')

/** Details for UI when chat context strategy changed the message list */
export type ChatContextManagementDetail = {
  strategyType: ContextStrategyType
  originalMessageCount: number
  finalMessageCount: number
  messagesRemoved: number
  tokensSaved: number
  summaryPreview?: string
  alterationSummary: string
}

export class ConversationService {
  /**
   * Applies the filtering pipeline that prepares UI messages for model consumption.
   * This keeps the logic testable and prevents future regressions when the pipeline changes.
   */
  static filterMessagesPipeline(messages: Message[], contextCount: number): Message[] {
    const messagesAfterContextClear = filterAfterContextClearMessages(messages)
    const usefulMessages = filterUsefulMessages(messagesAfterContextClear)
    // Run the error-only filter before trimming trailing assistant responses so the pair is removed together.
    const withoutErrorOnlyPairs = filterErrorOnlyMessagesWithRelated(usefulMessages)
    const withoutTrailingAssistant = filterLastAssistantMessage(withoutErrorOnlyPairs)
    const withoutAdjacentUsers = filterAdjacentUserMessaegs(withoutTrailingAssistant)
    const limitedByContext = takeRight(withoutAdjacentUsers, contextCount + 2)
    const contextClearFiltered = filterAfterContextClearMessages(limitedByContext)
    const nonEmptyMessages = filterEmptyMessages(contextClearFiltered)
    const userRoleStartMessages = filterUserRoleStartMessages(nonEmptyMessages)
    return userRoleStartMessages
  }

  static async prepareMessagesForModel(
    messages: Message[],
    assistant: Assistant,
    options: {
      topic?: Topic
      systemPrompt?: string
      maxOutputTokens?: number
      toolTokens?: number
      knowledgeTokens?: number
    } = {}
  ): Promise<{
    modelMessages: ModelMessage[]
    uiMessages: Message[]
    contextSummary?: string
    contextManagementApplied: boolean
    contextManagementDetail?: ChatContextManagementDetail
  }> {
    const { topic, systemPrompt, maxOutputTokens, toolTokens, knowledgeTokens } = options
    const { contextCount } = getAssistantSettings(assistant)
    const model = assistant.model || getDefaultModel()

    const lastUserMessage = findLast(messages, (m) => m.role === 'user')
    if (!lastUserMessage) {
      return {
        modelMessages: [],
        uiMessages: [],
        contextManagementApplied: false
      }
    }

    let uiMessagesFromPipeline = ConversationService.filterMessagesPipeline(messages, contextCount)
    logger.debug('uiMessagesFromPipeline', uiMessagesFromPipeline)

    if ((!uiMessagesFromPipeline || uiMessagesFromPipeline.length === 0) && lastUserMessage) {
      uiMessagesFromPipeline = [lastUserMessage]
    }

    const strategyConfig = getEffectiveStrategyConfig(topic, assistant)
    let contextSummary: string | undefined
    let contextManagementApplied = false
    let contextManagementDetail: ChatContextManagementDetail | undefined
    let finalUiMessages = uiMessagesFromPipeline

    if (isContextStrategyEnabled(strategyConfig)) {
      logger.debug('Applying context management strategy', {
        strategyType: strategyConfig.type,
        messageCount: uiMessagesFromPipeline.length,
        modelName: model.name,
        topicId: topic?.id
      })

      const strategyResult = await applyContextStrategy(uiMessagesFromPipeline, model, {
        topic,
        assistant,
        systemPrompt,
        maxOutputTokens,
        toolTokens,
        knowledgeTokens,
        existingSummary: topic?.contextMetadata?.conversationSummary,
        existingFacts: topic?.contextMetadata?.longTermFacts
      })

      if (strategyResult.wasApplied) {
        finalUiMessages = strategyResult.messages
        contextSummary = strategyResult.summary
        contextManagementApplied = true

        const summaryPreview =
          strategyResult.summary && strategyResult.summary.length > 0
            ? strategyResult.summary.length > 500
              ? `${strategyResult.summary.slice(0, 500)}…`
              : strategyResult.summary
            : undefined
        const alterationSummary = [
          `${strategyConfig.type}: ${uiMessagesFromPipeline.length}→${finalUiMessages.length} messages`,
          strategyResult.messagesRemoved > 0 ? `${strategyResult.messagesRemoved} removed` : null,
          strategyResult.tokensSaved > 0 ? `~${strategyResult.tokensSaved} tokens saved` : null
        ]
          .filter((x): x is string => Boolean(x))
          .join('; ')
        contextManagementDetail = {
          strategyType: strategyConfig.type,
          originalMessageCount: uiMessagesFromPipeline.length,
          finalMessageCount: finalUiMessages.length,
          messagesRemoved: strategyResult.messagesRemoved,
          tokensSaved: strategyResult.tokensSaved,
          summaryPreview,
          alterationSummary
        }

        logger.info('Context management applied', {
          strategy: strategyConfig.type,
          originalCount: uiMessagesFromPipeline.length,
          finalCount: finalUiMessages.length,
          messagesRemoved: strategyResult.messagesRemoved,
          tokensSaved: strategyResult.tokensSaved
        })
      } else {
        logger.debug('Context strategy executed but no changes needed', {
          strategy: strategyConfig.type,
          originalCount: uiMessagesFromPipeline.length
        })
      }
    } else {
      logger.debug('Context strategy disabled', {
        type: strategyConfig.type,
        modelName: model.name
      })
    }

    return {
      modelMessages: await convertMessagesToSdkMessages(finalUiMessages, model),
      uiMessages: finalUiMessages,
      contextSummary,
      contextManagementApplied,
      contextManagementDetail
    }
  }

  static needsWebSearch(assistant: Assistant): boolean {
    return !!assistant.webSearchProviderId
  }

  static needsKnowledgeSearch(assistant: Assistant): boolean {
    return !isEmpty(assistant.knowledge_bases)
  }
}
