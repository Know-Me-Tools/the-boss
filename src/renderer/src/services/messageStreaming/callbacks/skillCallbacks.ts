/**
 * @fileoverview Skill callbacks for handling skill activation during streaming
 *
 * This module provides callbacks for processing skill chunks:
 * - Skill activated: create a skill block when a skill fires
 * - Skill content delta: append streaming content to the block
 * - Skill complete: mark the block as completed with final token count
 *
 * ARCHITECTURE NOTE:
 * These callbacks use BlockManager for state management, consistent with other
 * callback modules in this package.
 */

import { loggerService } from '@logger'
import type { SkillActivatedChunk, SkillCompleteChunk, SkillContentDeltaChunk } from '@renderer/types/chunk'
import type { SkillMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import type { ContextManagementMethod, SkillSelectionMethod } from '@renderer/types/skillConfig'
import { createSkillBlock } from '@renderer/utils/messageUtils/create'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('SkillCallbacks')

interface SkillCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
}

export interface SkillCallbacks {
  onSkillActivated: (chunk: SkillActivatedChunk) => Promise<void>
  onSkillContentDelta: (chunk: SkillContentDeltaChunk) => void
  onSkillComplete: (chunk: SkillCompleteChunk) => void
}

export const createSkillCallbacks = (deps: SkillCallbacksDependencies): SkillCallbacks => {
  const { blockManager, assistantMsgId } = deps

  // Map from skillId -> block id, supporting multiple skills in one response
  const skillIdToBlockIdMap = new Map<string, string>()
  // Accumulate deltas client-side since smartBlockUpdate replaces (not appends) content
  const skillContentAccumulator = new Map<string, string>()

  return {
    onSkillActivated: async (chunk: SkillActivatedChunk) => {
      logger.debug('onSkillActivated', { skillId: chunk.skillId, skillName: chunk.skillName })

      const block = createSkillBlock({
        messageId: assistantMsgId,
        skillId: chunk.skillId,
        skillName: chunk.skillName,
        triggerTokens: chunk.triggerTokens,
        selectionReason: chunk.selectionReason,
        activationMethod: chunk.activationMethod as SkillSelectionMethod,
        similarityScore: chunk.similarityScore,
        contextManagementMethod: chunk.contextManagementMethod as ContextManagementMethod,
        originalTokenCount: chunk.originalTokenCount,
        managedTokenCount: chunk.managedTokenCount,
        tokensSaved: chunk.tokensSaved,
        truncated: chunk.truncated
      })

      skillIdToBlockIdMap.set(chunk.skillId, block.id)
      try {
        await blockManager.handleBlockTransition(block, MessageBlockType.SKILL)
      } catch (err) {
        logger.error(`[onSkillActivated] Failed to transition block for skillId: ${chunk.skillId}`, err as Error)
        skillIdToBlockIdMap.delete(chunk.skillId)
      }
    },

    onSkillContentDelta: (chunk: SkillContentDeltaChunk) => {
      const blockId = skillIdToBlockIdMap.get(chunk.skillId)
      if (!blockId) {
        logger.warn(`[onSkillContentDelta] No block found for skillId: ${chunk.skillId}`)
        return
      }

      const accumulated = (skillContentAccumulator.get(chunk.skillId) ?? '') + chunk.delta
      skillContentAccumulator.set(chunk.skillId, accumulated)

      const changes: Partial<SkillMessageBlock> = {
        content: accumulated,
        status: MessageBlockStatus.STREAMING
      }
      blockManager.smartBlockUpdate(blockId, changes, MessageBlockType.SKILL)
    },

    onSkillComplete: (chunk: SkillCompleteChunk) => {
      const blockId = skillIdToBlockIdMap.get(chunk.skillId)
      if (!blockId) {
        logger.warn(`[onSkillComplete] No block found for skillId: ${chunk.skillId}`)
        return
      }

      const changes: Partial<SkillMessageBlock> = {
        status: MessageBlockStatus.SUCCESS,
        tokenCount: chunk.finalTokenCount,
        managedTokenCount: chunk.finalTokenCount
      }
      blockManager.smartBlockUpdate(blockId, changes, MessageBlockType.SKILL, true)
      skillContentAccumulator.delete(chunk.skillId)
      skillIdToBlockIdMap.delete(chunk.skillId)
    }
  }
}
