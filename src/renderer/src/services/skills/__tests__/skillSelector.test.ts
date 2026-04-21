import type { SkillConfigOverride, SkillGlobalConfig } from '@renderer/types/skillConfig'
import { DEFAULT_SKILL_CONFIG, resolveSkillConfig, SkillSelectionMethod } from '@renderer/types/skillConfig'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SkillDescriptor } from '../skillRegistry'
import { SkillRegistry } from '../skillRegistry'
import { SkillSelector } from '../skillSelector'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    })
  }
}))

function makeConfig(overrides: SkillConfigOverride = {}): SkillGlobalConfig {
  return resolveSkillConfig(DEFAULT_SKILL_CONFIG, overrides)
}

function makeSkill(id: string, description: string, opts: Partial<SkillDescriptor> = {}): SkillDescriptor {
  return {
    id,
    name: id,
    description,
    triggerPatterns: [],
    getContent: () => `content for ${id}`,
    priority: 5,
    ...opts
  }
}

const skillA = makeSkill('skill-a', 'retrieval augmented generation knowledge base')
const skillB = makeSkill('skill-b', 'calendar scheduling and time management')
const skillC = makeSkill('skill-c', 'code generation and programming assistance')

function buildMockResolver(vectorMap: Record<string, number[]>) {
  const dim = Object.values(vectorMap)[0]?.length ?? 3
  const defaultVec = new Array(dim).fill(0)
  const embedFn = vi.fn(async (text: string) => vectorMap[text] ?? defaultVec)
  return {
    embed: embedFn,
    embedBatch: vi.fn(async (texts: string[]) => texts.map((t) => vectorMap[t] ?? defaultVec)),
    cosineSimilarity: (a: number[], b: number[]) => {
      let dot = 0
      let normA = 0
      let normB = 0
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        normA += a[i] * a[i]
        normB += b[i] * b[i]
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB)
      return denom === 0 ? 0 : dot / denom
    }
  }
}

describe('SkillSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('empty skills list', () => {
    const methods: SkillSelectionMethod[] = [
      SkillSelectionMethod.EMBEDDING,
      SkillSelectionMethod.HYBRID,
      SkillSelectionMethod.TWO_STAGE,
      SkillSelectionMethod.LLM_ROUTER,
      SkillSelectionMethod.LLM_DELEGATED
    ]

    for (const method of methods) {
      it(`returns [] for ${method} when skills list is empty`, async () => {
        const resolver = buildMockResolver({})
        const selector = new SkillSelector(
          makeConfig({ selectionMethod: method }),
          resolver as never,
          undefined,
          vi.fn()
        )
        const results = await selector.select('any prompt', [])
        expect(results).toEqual([])
      })
    }
  })

  it('returns [] when topK is 0', async () => {
    const resolver = buildMockResolver({
      'find relevant docs': [1, 0, 0],
      [skillA.description]: [1, 0, 0]
    })
    const selector = new SkillSelector(
      makeConfig({ methods: { [SkillSelectionMethod.EMBEDDING]: { topK: 0 } } }),
      resolver as never,
      undefined,
      vi.fn()
    )
    const results = await selector.select('find relevant docs', [skillA])
    expect(results).toEqual([])
  })

  describe('EMBEDDING method', () => {
    const prompt = 'find relevant documents using retrieval'

    it('selects skill with highest similarity above threshold', async () => {
      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [skillA.description]: [0.98, 0.1, 0],
        [skillB.description]: [0, 1, 0],
        [skillC.description]: [0, 0, 1]
      })
      const selector = new SkillSelector(
        makeConfig({
          selectionMethod: SkillSelectionMethod.EMBEDDING,
          methods: { [SkillSelectionMethod.EMBEDDING]: { similarityThreshold: 0.5 } }
        }),
        resolver as never,
        undefined,
        vi.fn()
      )
      const results = await selector.select(prompt, [skillA, skillB, skillC])

      expect(results[0].skill.id).toBe('skill-a')
      expect(results[0].score).toBeGreaterThan(0.5)
      expect(results[0].activationMethod).toBe(SkillSelectionMethod.EMBEDDING)
      expect(results[0].selectionReason).toMatch(/Semantic similarity/)
    })

    it('filters out skills below threshold', async () => {
      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [skillA.description]: [0.3, 0.9, 0],
        [skillB.description]: [0, 1, 0],
        [skillC.description]: [0, 0, 1]
      })
      const selector = new SkillSelector(
        makeConfig({
          selectionMethod: SkillSelectionMethod.EMBEDDING,
          methods: { [SkillSelectionMethod.EMBEDDING]: { similarityThreshold: 0.5 } }
        }),
        resolver as never,
        undefined,
        vi.fn()
      )
      const results = await selector.select(prompt, [skillA, skillB, skillC])
      expect(results).toHaveLength(0)
    })
  })

  describe('HYBRID method', () => {
    const prompt = 'retrieval knowledge base'

    it('includes skills matching trigger patterns', async () => {
      const triggeredSkill = makeSkill('triggered', 'some other topic', {
        triggerPatterns: [/retrieval/i]
      })
      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [skillA.description]: [0.9, 0.1, 0],
        [triggeredSkill.description]: [0, 1, 0]
      })
      const selector = new SkillSelector(
        makeConfig({ selectionMethod: SkillSelectionMethod.HYBRID }),
        resolver as never,
        undefined,
        vi.fn()
      )
      const results = await selector.select(prompt, [skillA, triggeredSkill])
      expect(results.map((result) => result.skill.id)).toContain('triggered')
    })
  })

  describe('TWO_STAGE method', () => {
    it('advances trigger and BM25 candidates before embedding rerank', async () => {
      const prompt = 'specific keyword query'
      const testRegistry = new SkillRegistry()

      const patternSkill = makeSkill('pattern-skill', 'specific keyword assistant', {
        triggerPatterns: [/specific/i]
      })
      const irrelevantSkill = makeSkill('irrelevant-skill', 'unrelated topic zxqwerty')

      testRegistry.register(patternSkill)
      testRegistry.register(irrelevantSkill)

      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [patternSkill.description]: [0.9, 0, 0],
        [irrelevantSkill.description]: [0.1, 0, 0]
      })

      const selector = new SkillSelector(
        makeConfig({
          selectionMethod: SkillSelectionMethod.TWO_STAGE,
          methods: { [SkillSelectionMethod.TWO_STAGE]: { similarityThreshold: 0.5, topK: 1 } }
        }),
        resolver as never,
        testRegistry,
        vi.fn()
      )

      const results = await selector.select(prompt, [patternSkill, irrelevantSkill])
      expect(results.map((result) => result.skill.id)).toContain('pattern-skill')
      expect(results[0].activationMethod).toBe(SkillSelectionMethod.TWO_STAGE)
    })
  })

  describe('LLM_ROUTER method', () => {
    it('uses embedding prefilter plus the LLM ranking response', async () => {
      const prompt = 'find relevant docs'
      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [skillA.description]: [1, 0, 0],
        [skillB.description]: [0.9, 0.1, 0]
      })
      const llmInvoker = vi.fn().mockResolvedValue({
        selections: [
          { id: 'skill-b', reason: 'calendar constraints are central' },
          { id: 'skill-a', reason: 'secondary relevance' }
        ]
      })

      const selector = new SkillSelector(
        makeConfig({
          selectionMethod: SkillSelectionMethod.LLM_ROUTER,
          methods: {
            [SkillSelectionMethod.LLM_ROUTER]: {
              llmModelId: 'router-model',
              similarityThreshold: 0.5,
              topK: 2
            }
          }
        }),
        resolver as never,
        undefined,
        llmInvoker
      )

      const results = await selector.select(prompt, [skillA, skillB])
      expect(llmInvoker).toHaveBeenCalledOnce()
      expect(results.map((result) => result.skill.id)).toEqual(['skill-b', 'skill-a'])
      expect(results[0].activationMethod).toBe(SkillSelectionMethod.LLM_ROUTER)
      expect(results[0].selectionReason).toMatch(/LLM router ranking/)
    })

    it('falls back to embedding when the LLM path fails', async () => {
      const prompt = 'find relevant docs'
      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [skillA.description]: [1, 0, 0]
      })
      const selector = new SkillSelector(
        makeConfig({
          selectionMethod: SkillSelectionMethod.LLM_ROUTER,
          methods: { [SkillSelectionMethod.LLM_ROUTER]: { similarityThreshold: 0.5 } }
        }),
        resolver as never,
        undefined,
        vi.fn().mockRejectedValue(new Error('router exploded'))
      )

      const results = await selector.select(prompt, [skillA])
      expect(results[0].activationMethod).toBe(SkillSelectionMethod.LLM_ROUTER)
      expect(results[0].selectionReason).toBe('LLM router fallback to embedding: router exploded')
    })
  })

  describe('LLM_DELEGATED method', () => {
    it('uses embedding prefilter plus the delegated LLM response', async () => {
      const prompt = 'find relevant docs'
      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [skillA.description]: [1, 0, 0],
        [skillB.description]: [0.9, 0.1, 0]
      })
      const llmInvoker = vi.fn().mockResolvedValue({
        selections: [{ id: 'skill-a', reason: 'best direct match' }]
      })

      const selector = new SkillSelector(
        makeConfig({
          selectionMethod: SkillSelectionMethod.LLM_DELEGATED,
          methods: {
            [SkillSelectionMethod.LLM_DELEGATED]: {
              llmModelId: 'delegate-model',
              similarityThreshold: 0.5
            }
          }
        }),
        resolver as never,
        undefined,
        llmInvoker
      )

      const results = await selector.select(prompt, [skillA, skillB])
      expect(results.map((result) => result.skill.id)).toEqual(['skill-a'])
      expect(results[0].activationMethod).toBe(SkillSelectionMethod.LLM_DELEGATED)
      expect(results[0].selectionReason).toMatch(/LLM delegated selection/)
    })
  })

  it('result objects contain the required fields', async () => {
    const prompt = 'retrieval augmented generation'
    const resolver = buildMockResolver({
      [prompt]: [1, 0, 0],
      [skillA.description]: [1, 0, 0]
    })
    const selector = new SkillSelector(
      makeConfig({ selectionMethod: SkillSelectionMethod.EMBEDDING }),
      resolver as never,
      undefined,
      vi.fn()
    )
    const [result] = await selector.select(prompt, [skillA])

    expect(result).toHaveProperty('skill')
    expect(result).toHaveProperty('score')
    expect(result).toHaveProperty('matchedKeywords')
    expect(result).toHaveProperty('selectionReason')
    expect(result).toHaveProperty('activationMethod')
  })
})
