// src/renderer/src/services/skills/__tests__/embeddingResolver.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EmbeddingResolver } from '../embeddingResolver'

// Mock fastembed to avoid loading WASM in test environment
vi.mock('@mastra/fastembed', () => ({
  EmbedMany: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]])
}))

describe('EmbeddingResolver', () => {
  let resolver: EmbeddingResolver

  beforeEach(() => {
    resolver = new EmbeddingResolver()
  })

  it('embed returns a number array', async () => {
    const vec = await resolver.embed('hello world')
    expect(Array.isArray(vec)).toBe(true)
    expect(typeof vec[0]).toBe('number')
    expect(vec.length).toBeGreaterThan(0)
  })

  it('cosineSimilarity returns 1 for identical non-zero vectors', () => {
    const v = [1, 0, 0]
    expect(resolver.cosineSimilarity(v, v)).toBeCloseTo(1)
  })

  it('cosineSimilarity returns 0 for orthogonal vectors', () => {
    expect(resolver.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('cosineSimilarity returns 0 for zero vectors (no divide-by-zero)', () => {
    expect(resolver.cosineSimilarity([0, 0], [0, 0])).toBe(0)
  })

  it('cosineSimilarity returns ~0.71 for 45-degree vectors', () => {
    expect(resolver.cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(0.707, 2)
  })
})
