import { describe, expect, it } from 'vitest'

import type { SkillActivatedChunk, SkillCompleteChunk, SkillContentDeltaChunk } from '../chunk'
import { ChunkType } from '../chunk'
import { ContextManagementMethod, SkillSelectionMethod } from '../skillConfig'

describe('skill chunk types', () => {
  it('SKILL_ACTIVATED has value "skill.activated"', () => {
    expect(ChunkType.SKILL_ACTIVATED).toBe('skill.activated')
  })
  it('SKILL_CONTENT_DELTA has value "skill.content_delta"', () => {
    expect(ChunkType.SKILL_CONTENT_DELTA).toBe('skill.content_delta')
  })
  it('SKILL_COMPLETE has value "skill.complete"', () => {
    expect(ChunkType.SKILL_COMPLETE).toBe('skill.complete')
  })
})

describe('SkillActivatedChunk shape', () => {
  it('can construct a valid SkillActivatedChunk', () => {
    const chunk: SkillActivatedChunk = {
      type: ChunkType.SKILL_ACTIVATED,
      skillId: 'agent-ui-patterns',
      skillName: 'Agent UI Patterns',
      triggerTokens: ['streaming', 'AG-UI'],
      selectionReason: 'Matches streaming patterns',
      estimatedTokens: 1240,
      content: 'full skill content',
      activationMethod: SkillSelectionMethod.EMBEDDING,
      similarityScore: 0.87,
      contextManagementMethod: ContextManagementMethod.PREFIX_CACHE_AWARE
    }
    expect(chunk.skillId).toBe('agent-ui-patterns')
    expect(chunk.activationMethod).toBe(SkillSelectionMethod.EMBEDDING)
  })
})

describe('SkillContentDeltaChunk shape', () => {
  it('can construct a valid SkillContentDeltaChunk', () => {
    const chunk: SkillContentDeltaChunk = {
      type: ChunkType.SKILL_CONTENT_DELTA,
      skillId: 'agent-ui-patterns',
      delta: 'partial content...'
    }
    expect(chunk.delta).toBe('partial content...')
  })
})

describe('SkillCompleteChunk shape', () => {
  it('can construct a valid SkillCompleteChunk', () => {
    const chunk: SkillCompleteChunk = {
      type: ChunkType.SKILL_COMPLETE,
      skillId: 'agent-ui-patterns',
      finalTokenCount: 1240
    }
    expect(chunk.finalTokenCount).toBe(1240)
  })
})
