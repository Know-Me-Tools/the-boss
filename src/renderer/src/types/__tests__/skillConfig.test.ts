import { describe, expect, it } from 'vitest'

import { ContextManagementMethod, DEFAULT_SKILL_CONFIG, SkillSelectionMethod } from '../skillConfig'

describe('SkillSelectionMethod', () => {
  it('has the five expected values', () => {
    expect(Object.values(SkillSelectionMethod)).toEqual([
      'llm_delegated',
      'embedding',
      'hybrid',
      'llm_router',
      'two_stage'
    ])
  })
})

describe('ContextManagementMethod', () => {
  it('has the five expected values', () => {
    expect(Object.values(ContextManagementMethod)).toEqual([
      'full_injection',
      'prefix_cache_aware',
      'chunked_rag',
      'summarized',
      'progressive'
    ])
  })
})

describe('DEFAULT_SKILL_CONFIG', () => {
  it('defaults to EMBEDDING selection and PREFIX_CACHE_AWARE context', () => {
    expect(DEFAULT_SKILL_CONFIG.selectionMethod).toBe(SkillSelectionMethod.EMBEDDING)
    expect(DEFAULT_SKILL_CONFIG.contextManagementMethod).toBe(ContextManagementMethod.PREFIX_CACHE_AWARE)
    expect(DEFAULT_SKILL_CONFIG.similarityThreshold).toBe(0.35)
    expect(DEFAULT_SKILL_CONFIG.topK).toBe(3)
    expect(DEFAULT_SKILL_CONFIG.maxSkillTokens).toBe(4096)
  })
})
