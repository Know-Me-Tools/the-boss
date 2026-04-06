// src/renderer/src/services/skills/__tests__/skillSelector.test.ts
import type { SkillGlobalConfig } from '@renderer/types/skillConfig'
import { SkillSelectionMethod } from '@renderer/types/skillConfig'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SkillDescriptor } from '../skillRegistry'
import { SkillSelector } from '../skillSelector'

// Mock logger
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    })
  }
}))

// Mock fastembed + ai to avoid WASM in tests
vi.mock('@mastra/fastembed', () => ({ fastembed: {} }))
vi.mock('ai', () => ({
  embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] })
}))

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<SkillGlobalConfig> = {}): SkillGlobalConfig {
  return {
    selectionMethod: SkillSelectionMethod.EMBEDDING,
    similarityThreshold: 0.5,
    topK: 3,
    contextManagementMethod: 'prefix_cache_aware' as any,
    maxSkillTokens: 4096,
    ...overrides
  }
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

// ────────────────────────────────────────────────────────────────────────────
// Shared skill fixtures
// ────────────────────────────────────────────────────────────────────────────

const skillA = makeSkill('skill-a', 'retrieval augmented generation knowledge base')
const skillB = makeSkill('skill-b', 'calendar scheduling and time management')
const skillC = makeSkill('skill-c', 'code generation and programming assistance')

// ────────────────────────────────────────────────────────────────────────────
// Helpers to build deterministic mock resolvers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns a mock EmbeddingResolver whose embed() returns the registered vector
 * for each text, defaulting to a zero vector when unrecognised.
 */
function buildMockResolver(vectorMap: Record<string, number[]>) {
  const dim = Object.values(vectorMap)[0]?.length ?? 3
  const defaultVec = new Array(dim).fill(0)
  return {
    embed: vi.fn(async (text: string) => vectorMap[text] ?? defaultVec),
    cosineSimilarity: (a: number[], b: number[]) => {
      // real cosine similarity so assertions are predictable
      let dot = 0,
        normA = 0,
        normB = 0
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

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('SkillSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── 1. Empty skills list ─────────────────────────────────────────────────

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
        const selector = new SkillSelector(makeConfig({ selectionMethod: method }), resolver as any)
        const results = await selector.select('any prompt', [])
        expect(results).toEqual([])
      })
    }
  })

  // ── 2. topK = 0 ──────────────────────────────────────────────────────────

  it('returns [] when topK is 0', async () => {
    const resolver = buildMockResolver({
      'find relevant docs': [1, 0, 0],
      [skillA.description]: [1, 0, 0]
    })
    const selector = new SkillSelector(makeConfig({ topK: 0 }), resolver as any)
    const results = await selector.select('find relevant docs', [skillA])
    expect(results).toEqual([])
  })

  // ── 3. EMBEDDING: selects skill with highest similarity above threshold ───

  describe('EMBEDDING method', () => {
    const prompt = 'find relevant documents using retrieval'

    it('selects skill with highest similarity above threshold', async () => {
      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [skillA.description]: [0.98, 0.1, 0], // high similarity
        [skillB.description]: [0, 1, 0], // orthogonal
        [skillC.description]: [0, 0, 1] // orthogonal
      })
      const selector = new SkillSelector(
        makeConfig({ selectionMethod: SkillSelectionMethod.EMBEDDING, similarityThreshold: 0.5 }),
        resolver as any
      )
      const results = await selector.select(prompt, [skillA, skillB, skillC])

      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].skill.id).toBe('skill-a')
      expect(results[0].score).toBeGreaterThan(0.5)
      expect(results[0].activationMethod).toBe(SkillSelectionMethod.EMBEDDING)
      expect(results[0].selectionReason).toMatch(/Semantic similarity/)
      expect(results[0].matchedKeywords).toEqual([])
    })

    it('filters out skills below threshold', async () => {
      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [skillA.description]: [0.3, 0.9, 0], // below 0.5 threshold
        [skillB.description]: [0, 1, 0], // orthogonal → 0
        [skillC.description]: [0, 0, 1] // orthogonal → 0
      })
      const selector = new SkillSelector(
        makeConfig({ selectionMethod: SkillSelectionMethod.EMBEDDING, similarityThreshold: 0.5 }),
        resolver as any
      )
      const results = await selector.select(prompt, [skillA, skillB, skillC])
      expect(results).toHaveLength(0)
    })

    it('respects topK limit', async () => {
      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [skillA.description]: [1, 0, 0], // similarity 1.0
        [skillB.description]: [0.95, 0.1, 0], // similarity ~0.99
        [skillC.description]: [0.9, 0.1, 0] // similarity ~0.99 but lower than B
      })
      const selector = new SkillSelector(
        makeConfig({
          selectionMethod: SkillSelectionMethod.EMBEDDING,
          similarityThreshold: 0.5,
          topK: 2
        }),
        resolver as any
      )
      const results = await selector.select(prompt, [skillA, skillB, skillC])
      expect(results).toHaveLength(2)
    })

    it('returns all skills that pass threshold when skills.length < topK', async () => {
      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [skillA.description]: [1, 0, 0]
      })
      const selector = new SkillSelector(
        makeConfig({
          selectionMethod: SkillSelectionMethod.EMBEDDING,
          similarityThreshold: 0.5,
          topK: 10
        }),
        resolver as any
      )
      const results = await selector.select(prompt, [skillA])
      expect(results).toHaveLength(1)
    })
  })

  // ── 4. HYBRID ─────────────────────────────────────────────────────────────

  describe('HYBRID method', () => {
    const prompt = 'retrieval knowledge base'

    it('includes skills matching trigger patterns', async () => {
      const triggeredSkill = makeSkill('triggered', 'some other topic', {
        triggerPatterns: [/retrieval/i]
      })
      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [skillA.description]: [0.9, 0.1, 0],
        [triggeredSkill.description]: [0, 1, 0] // low embedding similarity
      })
      const selector = new SkillSelector(
        makeConfig({ selectionMethod: SkillSelectionMethod.HYBRID, similarityThreshold: 0.5 }),
        resolver as any
      )
      const results = await selector.select(prompt, [skillA, triggeredSkill])
      const ids = results.map((r) => r.skill.id)
      expect(ids).toContain('triggered')
    })

    it('fuses BM25 and embedding scores via RRF', async () => {
      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [skillA.description]: [0.9, 0, 0], // high embedding
        [skillB.description]: [0.1, 0, 0], // low embedding
        [skillC.description]: [0.5, 0, 0] // mid embedding
      })
      const selector = new SkillSelector(
        makeConfig({ selectionMethod: SkillSelectionMethod.HYBRID, similarityThreshold: 0 }),
        resolver as any
      )
      const results = await selector.select(prompt, [skillA, skillB, skillC])
      // All should have rrf scores; first result should be skill-a (highest embedding)
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].skill.id).toBe('skill-a')
      expect(results[0].activationMethod).toBe(SkillSelectionMethod.HYBRID)
      expect(results[0].selectionReason).toMatch(/Hybrid BM25\+dense/)
    })
  })

  // ── 5. TWO_STAGE ─────────────────────────────────────────────────────────

  describe('TWO_STAGE method', () => {
    const prompt = 'code generation python'

    it('first filters by pattern match then re-ranks by embedding', async () => {
      const patternSkill = makeSkill('pattern-skill', 'code generation assistant', {
        triggerPatterns: [/code/i]
      })
      const noPatternSkill = makeSkill('no-pattern-skill', 'retrieval augmented search')

      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [patternSkill.description]: [0.9, 0, 0],
        [noPatternSkill.description]: [0.2, 0, 0] // high embedding but no trigger match
      })
      const selector = new SkillSelector(
        makeConfig({
          selectionMethod: SkillSelectionMethod.TWO_STAGE,
          similarityThreshold: 0.5
        }),
        resolver as any
      )
      const results = await selector.select(prompt, [patternSkill, noPatternSkill])
      const ids = results.map((r) => r.skill.id)
      // pattern-skill matches trigger + has high embedding; no-pattern-skill has low embedding
      expect(ids).toContain('pattern-skill')
      expect(results[0].activationMethod).toBe(SkillSelectionMethod.TWO_STAGE)
      expect(results[0].selectionReason).toMatch(/Two-stage/)
    })
  })

  // ── 6. LLM_ROUTER falls back to EMBEDDING ─────────────────────────────────

  describe('LLM_ROUTER method', () => {
    it('falls back to EMBEDDING and logs a warning', async () => {
      const prompt = 'find relevant docs'
      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [skillA.description]: [1, 0, 0]
      })
      const selector = new SkillSelector(
        makeConfig({
          selectionMethod: SkillSelectionMethod.LLM_ROUTER,
          similarityThreshold: 0.5
        }),
        resolver as any
      )
      const results = await selector.select(prompt, [skillA])
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].activationMethod).toBe(SkillSelectionMethod.LLM_ROUTER)
      expect(results[0].selectionReason).toBe('LLM routing (fallback to embedding)')
    })
  })

  // ── 7. LLM_DELEGATED falls back to EMBEDDING ──────────────────────────────

  describe('LLM_DELEGATED method', () => {
    it('falls back to EMBEDDING and logs a warning', async () => {
      const prompt = 'find relevant docs'
      const resolver = buildMockResolver({
        [prompt]: [1, 0, 0],
        [skillA.description]: [1, 0, 0]
      })
      const selector = new SkillSelector(
        makeConfig({
          selectionMethod: SkillSelectionMethod.LLM_DELEGATED,
          similarityThreshold: 0.5
        }),
        resolver as any
      )
      const results = await selector.select(prompt, [skillA])
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].activationMethod).toBe(SkillSelectionMethod.LLM_DELEGATED)
      expect(results[0].selectionReason).toBe('LLM delegated (fallback to embedding)')
    })
  })

  // ── 8. Result shape ───────────────────────────────────────────────────────

  it('result objects contain required fields', async () => {
    const prompt = 'retrieval augmented generation'
    const resolver = buildMockResolver({
      [prompt]: [1, 0, 0],
      [skillA.description]: [1, 0, 0]
    })
    const selector = new SkillSelector(
      makeConfig({ selectionMethod: SkillSelectionMethod.EMBEDDING, similarityThreshold: 0.5 }),
      resolver as any
    )
    const results = await selector.select(prompt, [skillA])
    expect(results).toHaveLength(1)
    const r = results[0]
    expect(r).toHaveProperty('skill')
    expect(r).toHaveProperty('score')
    expect(r).toHaveProperty('matchedKeywords')
    expect(r).toHaveProperty('selectionReason')
    expect(r).toHaveProperty('activationMethod')
    expect(typeof r.score).toBe('number')
    expect(Array.isArray(r.matchedKeywords)).toBe(true)
  })
})
