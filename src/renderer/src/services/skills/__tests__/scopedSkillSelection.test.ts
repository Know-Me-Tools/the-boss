import { ContextManagementMethod, DEFAULT_SKILL_CONFIG, SkillSelectionMethod } from '@renderer/types/skillConfig'
import type { InstalledSkill } from '@types'
import { describe, expect, it } from 'vitest'

import {
  buildAssistantSkillOverride,
  buildConversationSkillOverride,
  getSkillSelectionSummary
} from '../scopedSkillSelection'

const makeSkill = (id: string, name = id): InstalledSkill => ({
  id,
  name,
  description: `${name} description`,
  folderName: id,
  source: 'local',
  sourceUrl: null,
  namespace: null,
  author: null,
  tags: [],
  contentHash: `${id}-hash`,
  isEnabled: true,
  createdAt: 1,
  updatedAt: 1
})

describe('scopedSkillSelection', () => {
  describe('getSkillSelectionSummary', () => {
    it('summarizes unrestricted assistant skill configuration', () => {
      const summary = getSkillSelectionSummary(DEFAULT_SKILL_CONFIG, [makeSkill('skill-a'), makeSkill('skill-b')])

      expect(summary.mode).toBe('all')
      expect(summary.enabledSkillCount).toBe(2)
      expect(summary.selectedSkillCount).toBe(2)
      expect(summary.selectedSkills.map((skill) => skill.id)).toEqual(['skill-a', 'skill-b'])
    })

    it('summarizes explicit custom allowlists', () => {
      const summary = getSkillSelectionSummary(
        {
          ...DEFAULT_SKILL_CONFIG,
          selectionMethod: SkillSelectionMethod.HYBRID,
          contextManagementMethod: ContextManagementMethod.SUMMARIZED,
          selectedSkillIds: ['skill-b']
        },
        [makeSkill('skill-a'), makeSkill('skill-b')]
      )

      expect(summary.mode).toBe('custom')
      expect(summary.selectedSkillCount).toBe(1)
      expect(summary.selectedSkills.map((skill) => skill.id)).toEqual(['skill-b'])
    })

    it('summarizes explicit disabled state', () => {
      const summary = getSkillSelectionSummary(
        {
          ...DEFAULT_SKILL_CONFIG,
          selectedSkillIds: []
        },
        [makeSkill('skill-a'), makeSkill('skill-b')]
      )

      expect(summary.mode).toBe('none')
      expect(summary.selectedSkillCount).toBe(0)
      expect(summary.selectedSkills).toEqual([])
    })
  })

  describe('buildConversationSkillOverride', () => {
    it('creates a conversation-level allowlist when selecting a skill from inherited defaults', () => {
      const override = buildConversationSkillOverride({
        baseSkillConfig: DEFAULT_SKILL_CONFIG,
        effectiveSkillConfig: DEFAULT_SKILL_CONFIG,
        skillId: 'skill-a'
      })

      expect(override).toEqual({
        selectedSkillIds: ['skill-a']
      })
    })

    it('returns to inherited defaults when the last selected skill is removed', () => {
      const override = buildConversationSkillOverride({
        baseSkillConfig: DEFAULT_SKILL_CONFIG,
        effectiveSkillConfig: {
          ...DEFAULT_SKILL_CONFIG,
          selectedSkillIds: ['skill-a']
        },
        skillId: 'skill-a'
      })

      expect(override).toBeUndefined()
    })
  })

  describe('buildAssistantSkillOverride', () => {
    it('creates an explicit assistant allowlist when excluding a skill from inherited defaults', () => {
      const override = buildAssistantSkillOverride({
        baseSkillConfig: DEFAULT_SKILL_CONFIG,
        effectiveSkillConfig: DEFAULT_SKILL_CONFIG,
        selectableSkillIds: ['skill-a', 'skill-b'],
        skillId: 'skill-a'
      })

      expect(override).toEqual({
        selectedSkillIds: ['skill-b']
      })
    })

    it('keeps an explicit none override when the last assistant skill is turned off', () => {
      const override = buildAssistantSkillOverride({
        baseSkillConfig: DEFAULT_SKILL_CONFIG,
        effectiveSkillConfig: {
          ...DEFAULT_SKILL_CONFIG,
          selectedSkillIds: ['skill-a']
        },
        selectableSkillIds: ['skill-a', 'skill-b'],
        skillId: 'skill-a'
      })

      expect(override).toEqual({
        selectedSkillIds: []
      })
    })
  })
})
