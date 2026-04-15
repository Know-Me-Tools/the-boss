import { describe, expect, it } from 'vitest'

import {
  ContextManagementMethod,
  DEFAULT_SKILL_CONFIG,
  deriveSkillConfigOverride,
  getSkillMethodConfig,
  normalizeSkillConfig,
  resolveSkillConfig,
  SkillSelectionMethod
} from '../skillConfig'

describe('SkillSelectionMethod', () => {
  it('exposes all five method values', () => {
    expect(SkillSelectionMethod.LLM_DELEGATED).toBe('llm_delegated')
    expect(SkillSelectionMethod.EMBEDDING).toBe('embedding')
    expect(SkillSelectionMethod.HYBRID).toBe('hybrid')
    expect(SkillSelectionMethod.LLM_ROUTER).toBe('llm_router')
    expect(SkillSelectionMethod.TWO_STAGE).toBe('two_stage')
  })
})

describe('ContextManagementMethod', () => {
  it('exposes all five method values', () => {
    expect(ContextManagementMethod.FULL_INJECTION).toBe('full_injection')
    expect(ContextManagementMethod.PREFIX_CACHE_AWARE).toBe('prefix_cache_aware')
    expect(ContextManagementMethod.CHUNKED_RAG).toBe('chunked_rag')
    expect(ContextManagementMethod.SUMMARIZED).toBe('summarized')
    expect(ContextManagementMethod.PROGRESSIVE).toBe('progressive')
  })
})

describe('DEFAULT_SKILL_CONFIG', () => {
  it('defaults to EMBEDDING selection and PREFIX_CACHE_AWARE context', () => {
    expect(DEFAULT_SKILL_CONFIG.selectionMethod).toBe(SkillSelectionMethod.EMBEDDING)
    expect(DEFAULT_SKILL_CONFIG.contextManagementMethod).toBe(ContextManagementMethod.PREFIX_CACHE_AWARE)
    expect(DEFAULT_SKILL_CONFIG.maxSkillTokens).toBe(4096)
    expect(DEFAULT_SKILL_CONFIG.selectedSkillIds).toBeUndefined()
    expect(getSkillMethodConfig(DEFAULT_SKILL_CONFIG, SkillSelectionMethod.EMBEDDING).similarityThreshold).toBe(0.35)
    expect(getSkillMethodConfig(DEFAULT_SKILL_CONFIG, SkillSelectionMethod.EMBEDDING).topK).toBe(3)
    expect(getSkillMethodConfig(DEFAULT_SKILL_CONFIG, SkillSelectionMethod.HYBRID).topK).toBe(3)
  })
})

describe('normalizeSkillConfig', () => {
  it('reads legacy flat config and applies it to the relevant method buckets', () => {
    const normalized = normalizeSkillConfig({
      selectionMethod: SkillSelectionMethod.LLM_ROUTER,
      embeddingModelId: 'legacy-embedding-id',
      llmModelId: 'legacy-router-id',
      similarityThreshold: 0.72,
      topK: 9,
      contextManagementMethod: ContextManagementMethod.CHUNKED_RAG,
      maxSkillTokens: 2048
    })

    expect(normalized.selectionMethod).toBe(SkillSelectionMethod.LLM_ROUTER)
    expect(normalized.contextManagementMethod).toBe(ContextManagementMethod.CHUNKED_RAG)
    expect(normalized.maxSkillTokens).toBe(2048)
    expect(getSkillMethodConfig(normalized, SkillSelectionMethod.EMBEDDING).embeddingModelId).toBe(
      'legacy-embedding-id'
    )
    expect(getSkillMethodConfig(normalized, SkillSelectionMethod.EMBEDDING).similarityThreshold).toBe(0.72)
    expect(getSkillMethodConfig(normalized, SkillSelectionMethod.HYBRID).topK).toBe(9)
    expect(getSkillMethodConfig(normalized, SkillSelectionMethod.LLM_ROUTER).llmModelId).toBe('legacy-router-id')
    expect(getSkillMethodConfig(normalized, SkillSelectionMethod.LLM_DELEGATED).llmModelId).toBe('legacy-router-id')
  })
})

describe('resolveSkillConfig', () => {
  it('returns the normalized global config when no override is passed', () => {
    const result = resolveSkillConfig(DEFAULT_SKILL_CONFIG)
    expect(result).toEqual(DEFAULT_SKILL_CONFIG)
  })

  it('applies method-specific overrides without erasing other method buckets', () => {
    const result = resolveSkillConfig(DEFAULT_SKILL_CONFIG, {
      selectionMethod: SkillSelectionMethod.LLM_ROUTER,
      methods: {
        [SkillSelectionMethod.LLM_ROUTER]: {
          llmModelId: 'router-model',
          embeddingModelId: 'router-embedding',
          similarityThreshold: 0.8,
          topK: 7
        }
      }
    })

    expect(result.selectionMethod).toBe(SkillSelectionMethod.LLM_ROUTER)
    expect(getSkillMethodConfig(result, SkillSelectionMethod.LLM_ROUTER).llmModelId).toBe('router-model')
    expect(getSkillMethodConfig(result, SkillSelectionMethod.LLM_ROUTER).embeddingModelId).toBe('router-embedding')
    expect(getSkillMethodConfig(result, SkillSelectionMethod.LLM_ROUTER).similarityThreshold).toBe(0.8)
    expect(getSkillMethodConfig(result, SkillSelectionMethod.LLM_ROUTER).topK).toBe(7)
    expect(getSkillMethodConfig(result, SkillSelectionMethod.EMBEDDING).topK).toBe(3)
  })

  it('applies later scoped overrides after earlier ones', () => {
    const result = resolveSkillConfig(
      DEFAULT_SKILL_CONFIG,
      {
        methods: {
          [SkillSelectionMethod.EMBEDDING]: { topK: 4, similarityThreshold: 0.5 }
        }
      },
      {
        methods: {
          [SkillSelectionMethod.EMBEDDING]: { topK: 9 }
        }
      }
    )

    expect(getSkillMethodConfig(result, SkillSelectionMethod.EMBEDDING).topK).toBe(9)
    expect(getSkillMethodConfig(result, SkillSelectionMethod.EMBEDDING).similarityThreshold).toBe(0.5)
  })

  it('intersects selected skill ids across configured scopes', () => {
    const result = resolveSkillConfig(
      {
        ...DEFAULT_SKILL_CONFIG,
        selectedSkillIds: ['skill-a', 'skill-b', 'skill-c']
      },
      {
        selectedSkillIds: ['skill-b', 'skill-c', 'skill-d']
      },
      {
        selectedSkillIds: ['skill-c', 'skill-e']
      }
    )

    expect(result.selectedSkillIds).toEqual(['skill-c'])
  })

  it('treats undefined selected skill ids as inherit with no additional restriction', () => {
    const result = resolveSkillConfig(
      {
        ...DEFAULT_SKILL_CONFIG,
        selectedSkillIds: ['skill-a', 'skill-b']
      },
      undefined,
      {
        selectedSkillIds: ['skill-b', 'skill-c']
      }
    )

    expect(result.selectedSkillIds).toEqual(['skill-b'])
  })

  it('treats an explicit empty selected skill list as disable-all for that scope', () => {
    const result = resolveSkillConfig(
      {
        ...DEFAULT_SKILL_CONFIG,
        selectedSkillIds: ['skill-a', 'skill-b']
      },
      {
        selectedSkillIds: []
      }
    )

    expect(result.selectedSkillIds).toEqual([])
  })
})

describe('deriveSkillConfigOverride', () => {
  it('returns only the fields that differ from the base config', () => {
    const next = resolveSkillConfig(DEFAULT_SKILL_CONFIG, {
      selectionMethod: SkillSelectionMethod.LLM_DELEGATED,
      selectedSkillIds: ['skill-a'],
      methods: {
        [SkillSelectionMethod.LLM_DELEGATED]: {
          llmModelId: 'delegate-model',
          topK: 5
        }
      }
    })

    expect(deriveSkillConfigOverride(DEFAULT_SKILL_CONFIG, next)).toEqual({
      selectionMethod: SkillSelectionMethod.LLM_DELEGATED,
      selectedSkillIds: ['skill-a'],
      methods: {
        [SkillSelectionMethod.LLM_DELEGATED]: {
          llmModelId: 'delegate-model',
          topK: 5
        }
      }
    })
  })

  it('returns undefined when nothing differs from the base config', () => {
    expect(deriveSkillConfigOverride(DEFAULT_SKILL_CONFIG, DEFAULT_SKILL_CONFIG)).toBeUndefined()
  })

  it('preserves explicit empty selected skill ids when they differ from base', () => {
    const next = {
      ...DEFAULT_SKILL_CONFIG,
      selectedSkillIds: []
    }

    expect(deriveSkillConfigOverride(DEFAULT_SKILL_CONFIG, next)).toEqual({
      selectedSkillIds: []
    })
  })
})
