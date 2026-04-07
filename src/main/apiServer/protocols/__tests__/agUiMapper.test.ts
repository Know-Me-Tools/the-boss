import type { SkillActivatedStreamPayload } from '@shared/skillStream'
import { ContextManagementMethod, SkillSelectionMethod } from '@types'
import { describe, expect, it } from 'vitest'

import { createAgUiMapperState, mapTextStreamPartToAgUiEvents } from '../agUiMapper'

describe('agUiMapper', () => {
  it('maps backend skill activation stream parts to explicit AG-UI vendor events', () => {
    const state = createAgUiMapperState('thread-1')
    const payload: SkillActivatedStreamPayload = {
      skillId: 'skill-1',
      skillName: 'Planning Skill',
      triggerTokens: ['plan'],
      selectionReason: 'Matched planning intent',
      activationMethod: SkillSelectionMethod.HYBRID,
      similarityScore: 0.88,
      matchedKeywords: ['plan'],
      contextManagementMethod: ContextManagementMethod.FULL_INJECTION,
      content: 'planning content',
      originalTokenCount: 100,
      managedTokenCount: 70,
      tokensSaved: 30,
      truncated: false
    }

    const events = mapTextStreamPartToAgUiEvents(state, {
      type: 'data-skill-activated',
      data: payload
    } as any)

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'RunStarted' }),
        expect.objectContaining({ type: 'TEXT_MESSAGE_START' }),
        {
          type: 'theboss.skill_activated',
          payload
        }
      ])
    )
  })
})
