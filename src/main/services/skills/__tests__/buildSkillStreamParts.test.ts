import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ContextManagementMethod,
  DEFAULT_SKILL_CONFIG,
  resolveSkillConfig,
  SkillSelectionMethod
} from '../../../../renderer/src/types/skillConfig'

const { mockGetAll, mockSelect, mockPrepare } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockSelect: vi.fn(),
  mockPrepare: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('../skillRegistry', () => ({
  skillRegistry: {
    getAll: mockGetAll
  },
  SkillRegistry: class MockSkillRegistry {
    register = vi.fn()
    getAll = mockGetAll
  }
}))

vi.mock('../MainSkillSelector', () => ({
  MainSkillSelector: class MockMainSkillSelector {
    select = mockSelect
  }
}))

vi.mock('../contextManager', () => ({
  ContextManager: class MockContextManager {
    prepare = mockPrepare
  }
}))

import { buildSkillStreamParts } from '../buildSkillStreamParts'

function makeConfig() {
  return resolveSkillConfig({
    ...DEFAULT_SKILL_CONFIG,
    contextManagementMethod: ContextManagementMethod.FULL_INJECTION
  })
}

function makeSkillDescriptor(id: string, content = `content of ${id}`) {
  return {
    id,
    name: `Skill ${id}`,
    description: `Description for ${id}`,
    triggerPatterns: [],
    getContent: () => content,
    priority: 1
  }
}

function makeSelectorResult(skillId: string, content = `content of ${skillId}`) {
  return {
    skill: makeSkillDescriptor(skillId, content),
    score: 0.8,
    matchedKeywords: ['keyword1'],
    selectionReason: 'Semantic similarity: 0.80',
    activationMethod: SkillSelectionMethod.EMBEDDING
  }
}

describe('buildSkillStreamParts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns no parts when skill selection is disabled', async () => {
    mockGetAll.mockReturnValue([makeSkillDescriptor('skill-a')])

    const parts = await buildSkillStreamParts({
      prompt: 'hello',
      config: makeConfig(),
      disabled: true
    })

    expect(parts).toEqual([])
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockPrepare).not.toHaveBeenCalled()
  })

  it('builds stream parts when skill selection is enabled', async () => {
    mockGetAll.mockReturnValue([makeSkillDescriptor('skill-a')])
    mockSelect.mockResolvedValue([makeSelectorResult('skill-a', 'abc')])
    mockPrepare.mockResolvedValue({
      content: 'abc',
      tokenCount: 1,
      method: ContextManagementMethod.FULL_INJECTION,
      truncated: false
    })

    const parts = await buildSkillStreamParts({
      prompt: 'hello',
      config: makeConfig()
    })

    expect(parts).toHaveLength(3)
    expect(parts[0].type).toBe('data-skill-activated')
    expect(parts[1].type).toBe('data-skill-content-delta')
    expect(parts[2].type).toBe('data-skill-complete')
  })
})
