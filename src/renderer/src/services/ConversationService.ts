import { loggerService } from '@logger'
import { convertMessagesToSdkMessages } from '@renderer/aiCore/prepareParams'
import store from '@renderer/store'
import type { Assistant, Message } from '@renderer/types'
import { DEFAULT_CONTEXT_STRATEGY_CONFIG } from '@renderer/types/contextStrategy'
import type { ModelMessage } from 'ai'
import { findLast, isEmpty } from 'lodash'

import { getDefaultModel } from './AssistantService'
import { filterConversationMessagesForContext } from './chatContextStrategy'

const logger = loggerService.withContext('ConversationService')

export class ConversationService {
  /**
   * Applies the filtering pipeline that prepares UI messages for model consumption.
   * This keeps the logic testable and prevents future regressions when the pipeline changes.
   */
  static filterMessagesPipeline(messages: Message[], assistant: Assistant | number, topicId?: string): Message[] {
    const assistantConfig =
      typeof assistant === 'number'
        ? ({
            id: 'context-only',
            name: 'Context Only',
            prompt: '',
            topics: [],
            type: 'assistant',
            settings: {
              contextCount: assistant,
              temperature: 0,
              topP: 1,
              streamOutput: true,
              reasoning_effort: 'default',
              toolUseMode: 'function'
            }
          } as Assistant)
        : assistant

    return filterConversationMessagesForContext(
      messages,
      assistantConfig,
      store.getState().settings?.contextStrategy || DEFAULT_CONTEXT_STRATEGY_CONFIG,
      topicId
    ).messages
  }

  static async prepareMessagesForModel(
    messages: Message[],
    assistant: Assistant,
    topicId?: string
  ): Promise<{ modelMessages: ModelMessage[]; uiMessages: Message[] }> {
    // This logic is extracted from the original ApiService.fetchChatCompletion
    // const contextMessages = filterContextMessages(messages)
    const lastUserMessage = findLast(messages, (m) => m.role === 'user')
    if (!lastUserMessage) {
      return {
        modelMessages: [],
        uiMessages: []
      }
    }

    const uiMessagesFromPipeline = ConversationService.filterMessagesPipeline(messages, assistant, topicId)
    logger.debug('uiMessagesFromPipeline', uiMessagesFromPipeline)

    // Fallback: ensure at least the last user message is present to avoid empty payloads
    let uiMessages = uiMessagesFromPipeline
    if ((!uiMessages || uiMessages.length === 0) && lastUserMessage) {
      uiMessages = [lastUserMessage]
    }

    return {
      modelMessages: await convertMessagesToSdkMessages(uiMessages, assistant.model || getDefaultModel()),
      uiMessages
    }
  }

  static needsWebSearch(assistant: Assistant): boolean {
    return !!assistant.webSearchProviderId
  }

  static needsKnowledgeSearch(assistant: Assistant): boolean {
    return !isEmpty(assistant.knowledge_bases)
  }
}
