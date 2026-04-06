import { ContextManagementMethod, SkillSelectionMethod } from '@renderer/types'
import type { SkillActivatedChunk, SkillCompleteChunk, SkillContentDeltaChunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSkillCallbacks } from '../skillCallbacks'

// Minimal BlockManager mock
const createMockBlockManager = () => ({
  handleBlockTransition: vi.fn().mockResolvedValue(undefined),
  smartBlockUpdate: vi.fn(),
  hasInitialPlaceholder: false,
  initialPlaceholderBlockId: null,
  lastBlockType: null,
  activeBlockInfo: null
})

describe('createSkillCallbacks', () => {
  const assistantMsgId = 'msg-assistant-1'
  let blockManager: ReturnType<typeof createMockBlockManager>
  let callbacks: ReturnType<typeof createSkillCallbacks>

  beforeEach(() => {
    vi.clearAllMocks()
    blockManager = createMockBlockManager()
    callbacks = createSkillCallbacks({ blockManager: blockManager as any, assistantMsgId })
  })

  describe('onSkillActivated', () => {
    it('creates a SkillMessageBlock and calls handleBlockTransition', async () => {
      const chunk: SkillActivatedChunk = {
        type: ChunkType.SKILL_ACTIVATED,
        skillId: 'skill-abc',
        skillName: 'Test Skill',
        triggerTokens: ['keyword'],
        selectionReason: 'High similarity',
        estimatedTokens: 100,
        content: '',
        activationMethod: SkillSelectionMethod.EMBEDDING,
        contextManagementMethod: ContextManagementMethod.FULL_INJECTION
      }

      await callbacks.onSkillActivated(chunk)

      expect(blockManager.handleBlockTransition).toHaveBeenCalledTimes(1)
      const [passedBlock, blockType] = blockManager.handleBlockTransition.mock.calls[0]
      expect(blockType).toBe(MessageBlockType.SKILL)
      expect(passedBlock.type).toBe(MessageBlockType.SKILL)
      expect(passedBlock.messageId).toBe(assistantMsgId)
      expect(passedBlock.skillId).toBe('skill-abc')
      expect(passedBlock.skillName).toBe('Test Skill')
      expect(passedBlock.status).toBe(MessageBlockStatus.STREAMING)
      expect(passedBlock.tokenCount).toBe(0)
      expect(passedBlock.content).toBe('')
    })

    it('stores the block id keyed by skillId for subsequent updates', async () => {
      const chunk: SkillActivatedChunk = {
        type: ChunkType.SKILL_ACTIVATED,
        skillId: 'skill-xyz',
        skillName: 'Another Skill',
        triggerTokens: [],
        selectionReason: 'Match',
        estimatedTokens: 50,
        content: '',
        activationMethod: SkillSelectionMethod.HYBRID,
        contextManagementMethod: ContextManagementMethod.PREFIX_CACHE_AWARE
      }

      await callbacks.onSkillActivated(chunk)

      // Follow up with a content delta — should not log a warning
      const deltaChunk: SkillContentDeltaChunk = {
        type: ChunkType.SKILL_CONTENT_DELTA,
        skillId: 'skill-xyz',
        delta: 'some content'
      }
      callbacks.onSkillContentDelta(deltaChunk)
      expect(blockManager.smartBlockUpdate).toHaveBeenCalledTimes(1)
    })
  })

  describe('onSkillContentDelta', () => {
    it('appends delta to existing block content via smartBlockUpdate', async () => {
      const activatedChunk: SkillActivatedChunk = {
        type: ChunkType.SKILL_ACTIVATED,
        skillId: 'skill-1',
        skillName: 'Skill One',
        triggerTokens: ['foo'],
        selectionReason: 'reason',
        estimatedTokens: 10,
        content: '',
        activationMethod: SkillSelectionMethod.EMBEDDING,
        contextManagementMethod: ContextManagementMethod.CHUNKED_RAG
      }
      await callbacks.onSkillActivated(activatedChunk)

      const [createdBlock] = blockManager.handleBlockTransition.mock.calls[0]
      const blockId = createdBlock.id

      const deltaChunk: SkillContentDeltaChunk = {
        type: ChunkType.SKILL_CONTENT_DELTA,
        skillId: 'skill-1',
        delta: 'Hello World'
      }
      callbacks.onSkillContentDelta(deltaChunk)

      expect(blockManager.smartBlockUpdate).toHaveBeenCalledTimes(1)
      const [calledBlockId, changes, blockType] = blockManager.smartBlockUpdate.mock.calls[0]
      expect(calledBlockId).toBe(blockId)
      expect(changes.content).toBe('Hello World')
      expect(changes.status).toBe(MessageBlockStatus.STREAMING)
      expect(blockType).toBe(MessageBlockType.SKILL)
    })

    it('logs a warning and does nothing when no block exists for the skillId', () => {
      const deltaChunk: SkillContentDeltaChunk = {
        type: ChunkType.SKILL_CONTENT_DELTA,
        skillId: 'unknown-skill',
        delta: 'some delta'
      }
      // Should not throw
      callbacks.onSkillContentDelta(deltaChunk)
      expect(blockManager.smartBlockUpdate).not.toHaveBeenCalled()
    })
  })

  describe('onSkillComplete', () => {
    it('sets COMPLETED status and finalTokenCount via smartBlockUpdate', async () => {
      const activatedChunk: SkillActivatedChunk = {
        type: ChunkType.SKILL_ACTIVATED,
        skillId: 'skill-done',
        skillName: 'Done Skill',
        triggerTokens: [],
        selectionReason: 'done',
        estimatedTokens: 200,
        content: '',
        activationMethod: SkillSelectionMethod.LLM_ROUTER,
        contextManagementMethod: ContextManagementMethod.SUMMARIZED
      }
      await callbacks.onSkillActivated(activatedChunk)

      const [createdBlock] = blockManager.handleBlockTransition.mock.calls[0]
      const blockId = createdBlock.id

      const completeChunk: SkillCompleteChunk = {
        type: ChunkType.SKILL_COMPLETE,
        skillId: 'skill-done',
        finalTokenCount: 312
      }
      callbacks.onSkillComplete(completeChunk)

      expect(blockManager.smartBlockUpdate).toHaveBeenCalledTimes(1)
      const [calledBlockId, changes, blockType, isComplete] = blockManager.smartBlockUpdate.mock.calls[0]
      expect(calledBlockId).toBe(blockId)
      expect(changes.status).toBe(MessageBlockStatus.SUCCESS)
      expect(changes.tokenCount).toBe(312)
      expect(blockType).toBe(MessageBlockType.SKILL)
      expect(isComplete).toBe(true)
    })

    it('logs a warning and does nothing when no block exists for the skillId', () => {
      const completeChunk: SkillCompleteChunk = {
        type: ChunkType.SKILL_COMPLETE,
        skillId: 'nonexistent-skill',
        finalTokenCount: 10
      }
      // Should not throw
      callbacks.onSkillComplete(completeChunk)
      expect(blockManager.smartBlockUpdate).not.toHaveBeenCalled()
    })
  })
})
