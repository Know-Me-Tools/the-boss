import { ContextManagementMethod, SkillSelectionMethod } from '@renderer/types'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import { createSkillBlock } from '../create'

describe('createSkillBlock', () => {
  it('createSkillBlock returns a SkillMessageBlock with STREAMING status', () => {
    const block = createSkillBlock({
      messageId: 'msg-1',
      skillId: 'skill-abc',
      skillName: 'Test Skill',
      triggerTokens: ['keyword'],
      selectionReason: 'High similarity',
      activationMethod: SkillSelectionMethod.EMBEDDING,
      contextManagementMethod: ContextManagementMethod.FULL_INJECTION
    })
    expect(block.type).toBe(MessageBlockType.SKILL)
    expect(block.status).toBe(MessageBlockStatus.STREAMING)
    expect(block.tokenCount).toBe(0)
    expect(block.content).toBe('')
    expect(block.skillId).toBe('skill-abc')
  })

  it('sets messageId, skillName, triggerTokens, and selectionReason correctly', () => {
    const block = createSkillBlock({
      messageId: 'msg-2',
      skillId: 'skill-xyz',
      skillName: 'My Skill',
      triggerTokens: ['foo', 'bar'],
      selectionReason: 'Keyword match',
      activationMethod: SkillSelectionMethod.HYBRID,
      contextManagementMethod: ContextManagementMethod.PREFIX_CACHE_AWARE
    })
    expect(block.messageId).toBe('msg-2')
    expect(block.skillName).toBe('My Skill')
    expect(block.triggerTokens).toEqual(['foo', 'bar'])
    expect(block.selectionReason).toBe('Keyword match')
    expect(block.activationMethod).toBe(SkillSelectionMethod.HYBRID)
    expect(block.contextManagementMethod).toBe(ContextManagementMethod.PREFIX_CACHE_AWARE)
  })

  it('includes optional similarityScore when provided', () => {
    const block = createSkillBlock({
      messageId: 'msg-3',
      skillId: 'skill-1',
      skillName: 'Scored Skill',
      triggerTokens: [],
      selectionReason: 'Score above threshold',
      activationMethod: SkillSelectionMethod.EMBEDDING,
      similarityScore: 0.92,
      contextManagementMethod: ContextManagementMethod.CHUNKED_RAG
    })
    expect(block.similarityScore).toBe(0.92)
  })

  it('leaves similarityScore undefined when not provided', () => {
    const block = createSkillBlock({
      messageId: 'msg-4',
      skillId: 'skill-2',
      skillName: 'No Score Skill',
      triggerTokens: [],
      selectionReason: 'Exact match',
      activationMethod: SkillSelectionMethod.LLM_ROUTER,
      contextManagementMethod: ContextManagementMethod.SUMMARIZED
    })
    expect(block.similarityScore).toBeUndefined()
  })

  it('generates a unique id for each block', () => {
    const params = {
      messageId: 'msg-5',
      skillId: 'skill-3',
      skillName: 'Unique Skill',
      triggerTokens: [],
      selectionReason: 'test',
      activationMethod: SkillSelectionMethod.EMBEDDING,
      contextManagementMethod: ContextManagementMethod.FULL_INJECTION
    }
    const block1 = createSkillBlock(params)
    const block2 = createSkillBlock(params)
    expect(block1.id).toBeTruthy()
    expect(block2.id).toBeTruthy()
    expect(block1.id).not.toBe(block2.id)
  })
})
