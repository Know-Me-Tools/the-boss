import type { SkillActivatedChunk, SkillCompleteChunk, SkillContentDeltaChunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { ContextManagementMethod, SkillSelectionMethod } from '@renderer/types/skillConfig'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock loggerService used by StreamProcessingService
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

import { createStreamProcessor } from '../StreamProcessingService'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseSkillActivatedChunk: SkillActivatedChunk = {
  type: ChunkType.SKILL_ACTIVATED,
  skillId: 'skill-001',
  skillName: 'My Test Skill',
  triggerTokens: ['hello', 'world'],
  selectionReason: 'keyword match',
  content: 'Injected skill content here.',
  activationMethod: SkillSelectionMethod.EMBEDDING,
  contextManagementMethod: ContextManagementMethod.FULL_INJECTION,
  originalTokenCount: 640,
  managedTokenCount: 512,
  tokensSaved: 128,
  truncated: true
}

const baseSkillContentDeltaChunk: SkillContentDeltaChunk = {
  type: ChunkType.SKILL_CONTENT_DELTA,
  skillId: 'skill-001',
  delta: 'streaming delta text'
}

const baseSkillCompleteChunk: SkillCompleteChunk = {
  type: ChunkType.SKILL_COMPLETE,
  skillId: 'skill-001',
  finalTokenCount: 512
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StreamProcessingService – SKILL_* routing', () => {
  let onSkillActivated: ReturnType<typeof vi.fn>
  let onSkillContentDelta: ReturnType<typeof vi.fn>
  let onSkillComplete: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSkillActivated = vi.fn()
    onSkillContentDelta = vi.fn()
    onSkillComplete = vi.fn()
  })

  describe('SKILL_ACTIVATED chunk', () => {
    it('calls onSkillActivated with the full chunk data', () => {
      const processor = createStreamProcessor({ onSkillActivated })
      processor(baseSkillActivatedChunk)
      expect(onSkillActivated).toHaveBeenCalledOnce()
      expect(onSkillActivated).toHaveBeenCalledWith(baseSkillActivatedChunk)
    })

    it('does not throw when onSkillActivated is not provided', () => {
      const processor = createStreamProcessor({})
      expect(() => processor(baseSkillActivatedChunk)).not.toThrow()
    })

    it('accepts async callbacks without throwing', () => {
      const asyncCallback = vi.fn().mockResolvedValue(undefined)
      const processor = createStreamProcessor({ onSkillActivated: asyncCallback })
      expect(() => processor(baseSkillActivatedChunk)).not.toThrow()
      expect(asyncCallback).toHaveBeenCalledWith(baseSkillActivatedChunk)
    })

    it('passes through optional fields (similarityScore, matchedKeywords)', () => {
      const chunkWithOptionals: SkillActivatedChunk = {
        ...baseSkillActivatedChunk,
        similarityScore: 0.95,
        matchedKeywords: ['hello']
      }
      const processor = createStreamProcessor({ onSkillActivated })
      processor(chunkWithOptionals)
      expect(onSkillActivated).toHaveBeenCalledWith(chunkWithOptionals)
    })
  })

  describe('SKILL_CONTENT_DELTA chunk', () => {
    it('calls onSkillContentDelta with the full chunk data', () => {
      const processor = createStreamProcessor({ onSkillContentDelta })
      processor(baseSkillContentDeltaChunk)
      expect(onSkillContentDelta).toHaveBeenCalledOnce()
      expect(onSkillContentDelta).toHaveBeenCalledWith(baseSkillContentDeltaChunk)
    })

    it('does not throw when onSkillContentDelta is not provided', () => {
      const processor = createStreamProcessor({})
      expect(() => processor(baseSkillContentDeltaChunk)).not.toThrow()
    })
  })

  describe('SKILL_COMPLETE chunk', () => {
    it('calls onSkillComplete with the full chunk data', () => {
      const processor = createStreamProcessor({ onSkillComplete })
      processor(baseSkillCompleteChunk)
      expect(onSkillComplete).toHaveBeenCalledOnce()
      expect(onSkillComplete).toHaveBeenCalledWith(baseSkillCompleteChunk)
    })

    it('does not throw when onSkillComplete is not provided', () => {
      const processor = createStreamProcessor({})
      expect(() => processor(baseSkillCompleteChunk)).not.toThrow()
    })
  })

  describe('callbacks are all optional (no error if none provided)', () => {
    it('processes all three SKILL_* chunks without any callbacks registered', () => {
      const processor = createStreamProcessor()
      expect(() => {
        processor(baseSkillActivatedChunk)
        processor(baseSkillContentDeltaChunk)
        processor(baseSkillCompleteChunk)
      }).not.toThrow()
    })
  })

  describe('callback isolation', () => {
    it('does not invoke other callbacks when a SKILL_ACTIVATED chunk is processed', () => {
      const processor = createStreamProcessor({ onSkillActivated, onSkillContentDelta, onSkillComplete })
      processor(baseSkillActivatedChunk)
      expect(onSkillActivated).toHaveBeenCalledOnce()
      expect(onSkillContentDelta).not.toHaveBeenCalled()
      expect(onSkillComplete).not.toHaveBeenCalled()
    })

    it('does not invoke other callbacks when a SKILL_CONTENT_DELTA chunk is processed', () => {
      const processor = createStreamProcessor({ onSkillActivated, onSkillContentDelta, onSkillComplete })
      processor(baseSkillContentDeltaChunk)
      expect(onSkillContentDelta).toHaveBeenCalledOnce()
      expect(onSkillActivated).not.toHaveBeenCalled()
      expect(onSkillComplete).not.toHaveBeenCalled()
    })

    it('does not invoke other callbacks when a SKILL_COMPLETE chunk is processed', () => {
      const processor = createStreamProcessor({ onSkillActivated, onSkillContentDelta, onSkillComplete })
      processor(baseSkillCompleteChunk)
      expect(onSkillComplete).toHaveBeenCalledOnce()
      expect(onSkillActivated).not.toHaveBeenCalled()
      expect(onSkillContentDelta).not.toHaveBeenCalled()
    })
  })
})
