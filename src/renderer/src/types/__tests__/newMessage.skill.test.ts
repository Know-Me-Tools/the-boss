import { describe, expect, it } from 'vitest'

import type { SkillMessageBlock } from '../newMessage'
import { MessageBlockStatus, MessageBlockType } from '../newMessage'
import { ContextManagementMethod, SkillSelectionMethod } from '../skillConfig'

describe('MessageBlockType.SKILL', () => {
  it('has value "skill"', () => {
    expect(MessageBlockType.SKILL).toBe('skill')
  })
})

describe('SkillMessageBlock shape', () => {
  it('can construct a valid SkillMessageBlock', () => {
    const block: SkillMessageBlock = {
      id: 'block-1',
      messageId: 'msg-1',
      type: MessageBlockType.SKILL,
      createdAt: new Date().toISOString(),
      status: MessageBlockStatus.STREAMING,
      skillId: 'agent-ui-patterns',
      skillName: 'Agent UI Patterns',
      triggerTokens: ['streaming', 'AG-UI'],
      selectionReason: 'Matches AG-UI streaming event pattern queries',
      tokenCount: 1240,
      content: 'This skill provides AG-UI patterns.',
      activationMethod: SkillSelectionMethod.EMBEDDING,
      similarityScore: 0.87,
      contextManagementMethod: ContextManagementMethod.PREFIX_CACHE_AWARE,
      originalTokenCount: 1520,
      managedTokenCount: 1240,
      tokensSaved: 280,
      truncated: true
    }
    expect(block.type).toBe(MessageBlockType.SKILL)
    expect(block.skillId).toBe('agent-ui-patterns')
    expect(block.activationMethod).toBe(SkillSelectionMethod.EMBEDDING)
    expect(block.contextManagementMethod).toBe(ContextManagementMethod.PREFIX_CACHE_AWARE)
  })

  it('similarityScore is optional', () => {
    const block: SkillMessageBlock = {
      id: 'block-2',
      messageId: 'msg-1',
      type: MessageBlockType.SKILL,
      createdAt: new Date().toISOString(),
      status: MessageBlockStatus.SUCCESS,
      skillId: 'test',
      skillName: 'Test',
      triggerTokens: [],
      selectionReason: 'test',
      tokenCount: 100,
      content: 'content',
      activationMethod: SkillSelectionMethod.LLM_DELEGATED,
      contextManagementMethod: ContextManagementMethod.FULL_INJECTION,
      originalTokenCount: 100,
      managedTokenCount: 100,
      tokensSaved: 0,
      truncated: false
    }
    expect(block.similarityScore).toBeUndefined()
  })
})
