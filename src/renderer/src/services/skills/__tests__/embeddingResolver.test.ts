// src/renderer/src/services/skills/__tests__/embeddingResolver.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EmbeddingResolver } from '../embeddingResolver'

// Mock fastembed to avoid loading WASM in test environment
vi.mock('@mastra/fastembed', () => ({ fastembed: {} }))

// Mock ai package's embed function
vi.mock('ai', () => ({
  embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] })
}))

describe('EmbeddingResolver', () => {
  let resolver: EmbeddingResolver

  beforeEach(() => {
    resolver = new EmbeddingResolver()
    vi.clearAllMocks()
  })

  it('embed returns a number array via fastembed when no modelId is set', async () => {
    const vec = await resolver.embed('hello world')
    expect(Array.isArray(vec)).toBe(true)
    expect(typeof vec[0]).toBe('number')
    expect(vec.length).toBeGreaterThan(0)
  })

  it('embed calls window.api.embedText when modelId is set', async () => {
    const mockEmbedText = vi.fn().mockResolvedValue([0.4, 0.5, 0.6])
    ;(window as any).api = { embedText: mockEmbedText }

    const resolverWithModel = new EmbeddingResolver('my-model')
    const vec = await resolverWithModel.embed('hello world')

    expect(mockEmbedText).toHaveBeenCalledWith({ modelId: 'my-model', text: 'hello world' })
    expect(vec).toEqual([0.4, 0.5, 0.6])

    delete (window as any).api
  })

  it('embed falls back to fastembed when window.api.embedText throws', async () => {
    const mockEmbedText = vi.fn().mockRejectedValue(new Error('IPC error'))
    ;(window as any).api = { embedText: mockEmbedText }

    const { embed: mockEmbed } = await import('ai')
    vi.mocked(mockEmbed).mockResolvedValue({ embedding: [0.7, 0.8, 0.9] } as any)

    const resolverWithModel = new EmbeddingResolver('my-model')
    const vec = await resolverWithModel.embed('fallback test')

    expect(mockEmbedText).toHaveBeenCalled()
    expect(vec).toEqual([0.7, 0.8, 0.9])

    delete (window as any).api
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

  it('cosineSimilarity throws on mismatched vector lengths', () => {
    expect(() => resolver.cosineSimilarity([1, 0, 0], [1, 0])).toThrow('Vector length mismatch')
  })
})
