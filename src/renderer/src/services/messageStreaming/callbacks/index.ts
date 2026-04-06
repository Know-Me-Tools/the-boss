/**
 * @fileoverview Callbacks factory for streaming message processing
 *
 * This module creates and composes all callback handlers used during
 * message streaming. Each callback type handles specific aspects:
 * - Base: session lifecycle, error handling, completion
 * - Text: main text block processing
 * - Thinking: thinking/reasoning block processing
 * - Tool: tool call/result processing
 * - Image: image generation processing
 * - Citation: web search/knowledge citations
 * - Video: video content processing
 * - Compact: /compact command handling
 * - Skill: skill activation and context injection
 *
 * ARCHITECTURE NOTE:
 * These callbacks now use StreamingService for state management instead of Redux dispatch.
 * This is part of the v2 data refactoring to use CacheService + Data API.
 */

import type { Assistant } from '@renderer/types'

import type { BlockManager } from '../BlockManager'
import { createBaseCallbacks } from './baseCallbacks'
import { createCitationCallbacks } from './citationCallbacks'
import { createCompactCallbacks } from './compactCallbacks'
import { createImageCallbacks } from './imageCallbacks'
import { createSkillCallbacks } from './skillCallbacks'
import { createTextCallbacks } from './textCallbacks'
import { createThinkingCallbacks } from './thinkingCallbacks'
import { createToolCallbacks } from './toolCallbacks'
import { createVideoCallbacks } from './videoCallbacks'

export { createSkillCallbacks } from './skillCallbacks'

/**
 * Dependencies required for creating all callbacks
 *
 * NOTE: Simplified from original design - removed dispatch, getState, and saveUpdatesToDB
 * since StreamingService now handles state management and persistence.
 */
interface CallbacksDependencies {
  blockManager: BlockManager
  topicId: string
  assistantMsgId: string
  assistant: Assistant
}

export const createCallbacks = (deps: CallbacksDependencies) => {
  const { blockManager, topicId, assistantMsgId, assistant } = deps

  // 首先创建 thinkingCallbacks ，以便传递 getCurrentThinkingInfo 给 baseCallbacks
  const thinkingCallbacks = createThinkingCallbacks({
    blockManager,
    assistantMsgId
  })

  // Create base callbacks (lifecycle, error, complete)
  const baseCallbacks = createBaseCallbacks({
    blockManager,
    topicId,
    assistantMsgId,
    assistant,
    getCurrentThinkingInfo: thinkingCallbacks.getCurrentThinkingInfo
  })

  const toolCallbacks = createToolCallbacks({
    blockManager,
    assistantMsgId
  })

  const imageCallbacks = createImageCallbacks({
    blockManager,
    assistantMsgId
  })

  const citationCallbacks = createCitationCallbacks({
    blockManager,
    assistantMsgId
  })

  const videoCallbacks = createVideoCallbacks({ blockManager, assistantMsgId })

  const compactCallbacks = createCompactCallbacks({
    blockManager,
    assistantMsgId,
    topicId
  })

  const skillCallbacks = createSkillCallbacks({
    blockManager,
    assistantMsgId
  })

  // Create textCallbacks with citation and compact handlers
  const textCallbacks = createTextCallbacks({
    blockManager,
    assistantMsgId,
    getCitationBlockId: citationCallbacks.getCitationBlockId,
    getCitationBlockIdFromTool: toolCallbacks.getCitationBlockId,
    handleCompactTextComplete: compactCallbacks.handleTextComplete
  })

  // Compose all callbacks
  return {
    ...baseCallbacks,
    ...textCallbacks,
    ...thinkingCallbacks,
    ...toolCallbacks,
    ...imageCallbacks,
    ...citationCallbacks,
    ...videoCallbacks,
    ...compactCallbacks,
    ...skillCallbacks,
    // Cleanup method (throttling is managed by messageThunk)
    cleanup: () => {
      // Cleanup is managed by messageThunk throttle functions
      // Add any additional cleanup here if needed
    }
  }
}
