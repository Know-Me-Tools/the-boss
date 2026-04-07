// src/renderer/src/services/skills/__tests__/embeddingResolver.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EmbeddingResolver } from '../embeddingResolver'

describe('EmbeddingResolver', () => {
  let resolver: EmbeddingResolver

  beforeEach(() => {
    resolver = new EmbeddingResolver()
    vi.clearAllMocks()
    ;(window as any).api = {
      embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
    }
  })

  it('embed returns a number array via window.api.embedText when no modelId is set', async () => {
    const vec = await resolver.embed('hello world')
    expect((window as any).api.embedText).toHaveBeenCalledWith({ modelId: undefined, text: 'hello world' })
    expect(vec).toEqual([0.1, 0.2, 0.3])
  })

  it('embed calls window.api.embedText with modelId when set', async () => {
    const mockEmbedText = vi.fn().mockResolvedValue([0.4, 0.5, 0.6])
    ;(window as any).api = { embedText: mockEmbedText }

    const resolverWithModel = new EmbeddingResolver('my-model')
    const vec = await resolverWithModel.embed('hello world')

    expect(mockEmbedText).toHaveBeenCalledWith({ modelId: 'my-model', text: 'hello world' })
    expect(vec).toEqual([0.4, 0.5, 0.6])
  })

  it('embed propagates when window.api.embedText throws', async () => {
    const mockEmbedText = vi.fn().mockRejectedValue(new Error('IPC error'))
    ;(window as any).api = { embedText: mockEmbedText }

    const resolverWithModel = new EmbeddingResolver('my-model')
    await expect(resolverWithModel.embed('fallback test')).rejects.toThrow('IPC error')
    expect(mockEmbedText).toHaveBeenCalled()
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
