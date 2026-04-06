import { describe, expect, it } from 'vitest'

import { ContextManagementMethod, DEFAULT_SKILL_CONFIG, resolveSkillConfig, SkillSelectionMethod } from '../skillConfig'

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

describe('resolveSkillConfig', () => {
  it('returns global config unchanged when no override is passed', () => {
    const result = resolveSkillConfig(DEFAULT_SKILL_CONFIG)
    expect(result).toBe(DEFAULT_SKILL_CONFIG)
  })

  it('falls through to global for all fields when an empty override object is passed', () => {
    const result = resolveSkillConfig(DEFAULT_SKILL_CONFIG, {})
    expect(result.selectionMethod).toBe(DEFAULT_SKILL_CONFIG.selectionMethod)
    expect(result.embeddingModelId).toBe(DEFAULT_SKILL_CONFIG.embeddingModelId)
    expect(result.similarityThreshold).toBe(DEFAULT_SKILL_CONFIG.similarityThreshold)
    expect(result.topK).toBe(DEFAULT_SKILL_CONFIG.topK)
    expect(result.contextManagementMethod).toBe(DEFAULT_SKILL_CONFIG.contextManagementMethod)
    expect(result.maxSkillTokens).toBe(DEFAULT_SKILL_CONFIG.maxSkillTokens)
  })

  it('applies only the overridden field and inherits the rest from global when a partial override is passed', () => {
    const result = resolveSkillConfig(DEFAULT_SKILL_CONFIG, { topK: 10 })
    expect(result.topK).toBe(10)
    expect(result.selectionMethod).toBe(DEFAULT_SKILL_CONFIG.selectionMethod)
    expect(result.embeddingModelId).toBe(DEFAULT_SKILL_CONFIG.embeddingModelId)
    expect(result.similarityThreshold).toBe(DEFAULT_SKILL_CONFIG.similarityThreshold)
    expect(result.contextManagementMethod).toBe(DEFAULT_SKILL_CONFIG.contextManagementMethod)
    expect(result.maxSkillTokens).toBe(DEFAULT_SKILL_CONFIG.maxSkillTokens)
  })

  it('takes every field from override when a full override is passed', () => {
    const fullOverride = {
      selectionMethod: SkillSelectionMethod.HYBRID,
      embeddingModelId: 'custom-model-id',
      similarityThreshold: 0.75,
      topK: 8,
      contextManagementMethod: ContextManagementMethod.CHUNKED_RAG,
      maxSkillTokens: 2048
    }
    const result = resolveSkillConfig(DEFAULT_SKILL_CONFIG, fullOverride)
    expect(result.selectionMethod).toBe(SkillSelectionMethod.HYBRID)
    expect(result.embeddingModelId).toBe('custom-model-id')
    expect(result.similarityThreshold).toBe(0.75)
    expect(result.topK).toBe(8)
    expect(result.contextManagementMethod).toBe(ContextManagementMethod.CHUNKED_RAG)
    expect(result.maxSkillTokens).toBe(2048)
  })
})
