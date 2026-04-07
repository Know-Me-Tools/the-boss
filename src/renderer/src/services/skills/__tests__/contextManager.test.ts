// src/renderer/src/services/skills/__tests__/contextManager.test.ts
import { ContextManagementMethod } from '@renderer/types/skillConfig'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ContextManager } from '../contextManager'

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

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ContextManager', () => {
  let manager: ContextManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new ContextManager()
  })

  // ── FULL_INJECTION ──────────────────────────────────────────────────────────

  describe('FULL_INJECTION', () => {
    it('returns content unchanged when within budget', async () => {
      const content = 'Hello world'
      const result = await manager.prepare(content, {
        method: ContextManagementMethod.FULL_INJECTION,
        maxTokens: 1000,
        prompt: 'test'
      })

      expect(result.content).toBe(content)
      expect(result.truncated).toBe(false)
      expect(result.method).toBe(ContextManagementMethod.FULL_INJECTION)
      expect(result.tokenCount).toBe(estimateTokens(content))
    })

    it('truncates and marks truncated when over budget', async () => {
      // Create content that exceeds maxTokens budget
      const maxTokens = 10 // 40 chars budget
      const content = 'A'.repeat(100) // 100 chars → 25 tokens, over budget

      const result = await manager.prepare(content, {
        method: ContextManagementMethod.FULL_INJECTION,
        maxTokens,
        prompt: 'test'
      })

      expect(result.truncated).toBe(true)
      expect(result.content).toContain('...[truncated]')
      expect(result.content.length).toBeLessThanOrEqual(maxTokens * 4 + '...[truncated]'.length)
    })
  })

  // ── PREFIX_CACHE_AWARE ──────────────────────────────────────────────────────

  describe('PREFIX_CACHE_AWARE', () => {
    it('wraps content with skill_context tags', async () => {
      const content = 'some skill content'
      const result = await manager.prepare(content, {
        method: ContextManagementMethod.PREFIX_CACHE_AWARE,
        maxTokens: 1000,
        prompt: 'test'
      })

      expect(result.content).toMatch(/^<skill_context>\n/)
      expect(result.content).toMatch(/\n<\/skill_context>$/)
      expect(result.content).toContain(content)
      expect(result.method).toBe(ContextManagementMethod.PREFIX_CACHE_AWARE)
    })

    it('truncates to fit maxTokens including wrapper overhead', async () => {
      const maxTokens = 20 // 80 chars budget
      // Content large enough to require truncation after accounting for wrapper
      const content = 'X'.repeat(200)

      const result = await manager.prepare(content, {
        method: ContextManagementMethod.PREFIX_CACHE_AWARE,
        maxTokens,
        prompt: 'test'
      })

      expect(result.tokenCount).toBeLessThanOrEqual(maxTokens)
      expect(result.content).toMatch(/^<skill_context>\n/)
      expect(result.content).toMatch(/\n<\/skill_context>$/)
    })
  })

  // ── CHUNKED_RAG ─────────────────────────────────────────────────────────────

  describe('CHUNKED_RAG', () => {
    it('selects highest-similarity chunk, drops lower-ranked chunks, and sets truncated=true under tight budget', async () => {
      // CHUNK_SIZE_CHARS is 800. Build 3 distinct chunks of exactly 800 chars each.
      const chunkA = 'retrieval augmented generation '.repeat(26).slice(0, 800) // high similarity
      const chunkB = 'cooking recipes and food prep '.repeat(27).slice(0, 800) // low similarity
      const chunkC = 'machine learning model training '.repeat(25).slice(0, 800) // low similarity
      const content = chunkA + chunkB + chunkC

      const prompt = 'retrieval augmented generation'

      const resolver = buildMockResolver({ [prompt]: [1, 0, 0] })
      resolver.embed = vi.fn(async (text: string) => {
        if (text === prompt || text.includes('retrieval')) return [1, 0, 0]
        if (text.includes('cooking')) return [0, 1, 0]
        return [0, 0, 1]
      })

      // Budget = 300 tokens = 1200 chars — fits only 1 chunk (800 chars), not all 3
      const result = await manager.prepare(content, {
        method: ContextManagementMethod.CHUNKED_RAG,
        maxTokens: 300,
        prompt,
        resolver: resolver as any
      })

      expect(result.method).toBe(ContextManagementMethod.CHUNKED_RAG)
      // Highest-similarity chunk (chunkA) must appear
      expect(result.content).toContain('retrieval')
      // Lower-ranked chunk C must be excluded (budget only fits 1 chunk)
      expect(result.content).not.toContain('machine learning')
      // truncated because not all 3 chunks fit
      expect(result.truncated).toBe(true)
    })

    it('falls back to FULL_INJECTION when no resolver provided', async () => {
      const content = 'some content for rag'

      const result = await manager.prepare(content, {
        method: ContextManagementMethod.CHUNKED_RAG,
        maxTokens: 1000,
        prompt: 'test prompt'
        // no resolver
      })

      // Falls back to FULL_INJECTION behavior: returns content as-is
      expect(result.content).toBe(content)
      expect(result.method).toBe(ContextManagementMethod.CHUNKED_RAG)
      expect(result.truncated).toBe(false)
    })
  })

  // ── SUMMARIZED ──────────────────────────────────────────────────────────────

  describe('SUMMARIZED', () => {
    it('truncates to maxTokens and prepends [Summary]', async () => {
      const maxTokens = 10 // 40 chars budget
      const content = 'B'.repeat(200) // well over budget

      const result = await manager.prepare(content, {
        method: ContextManagementMethod.SUMMARIZED,
        maxTokens,
        prompt: 'test'
      })

      expect(result.content).toMatch(/^\[Summary\] /)
      expect(result.truncated).toBe(true)
      expect(result.method).toBe(ContextManagementMethod.SUMMARIZED)
      // Content (minus prefix) should be truncated; body chars ≤ budget + suffix length
      const TRUNCATION_SUFFIX = '...[truncated]'
      const bodyContent = result.content.slice('[Summary] '.length)
      expect(bodyContent.length).toBeLessThanOrEqual(maxTokens * 4 + TRUNCATION_SUFFIX.length)
      // Total tokenCount must stay within the maxTokens budget
      expect(result.tokenCount).toBeLessThanOrEqual(maxTokens)
    })

    it('returns full content with [Summary] prefix when within budget', async () => {
      const content = 'short content'
      const result = await manager.prepare(content, {
        method: ContextManagementMethod.SUMMARIZED,
        maxTokens: 1000,
        prompt: 'test'
      })

      expect(result.content).toBe('[Summary] ' + content)
      expect(result.truncated).toBe(false)
    })
  })

  // ── PROGRESSIVE ─────────────────────────────────────────────────────────────

  describe('PROGRESSIVE', () => {
    it('returns preview with continuation marker for long content', async () => {
      // Content longer than 256 tokens (1024 chars)
      const content = 'C'.repeat(2000)

      const result = await manager.prepare(content, {
        method: ContextManagementMethod.PROGRESSIVE,
        maxTokens: 10000,
        prompt: 'test'
      })

      expect(result.content).toContain('\n[...full content available on request]')
      expect(result.truncated).toBe(true)
      expect(result.method).toBe(ContextManagementMethod.PROGRESSIVE)
      // Preview is first 1024 chars
      const preview = result.content.replace('\n[...full content available on request]', '')
      expect(preview.length).toBe(1024)
    })

    it('returns full content without marker for short content', async () => {
      const content = 'D'.repeat(100) // well within 256 token limit

      const result = await manager.prepare(content, {
        method: ContextManagementMethod.PROGRESSIVE,
        maxTokens: 10000,
        prompt: 'test'
      })

      expect(result.content).toBe(content)
      expect(result.content).not.toContain('[...full content available on request]')
      expect(result.truncated).toBe(false)
    })
  })

  // ── Empty content ────────────────────────────────────────────────────────────

  describe('empty content returns empty ManagedContext for all methods', () => {
    const methods = [
      ContextManagementMethod.FULL_INJECTION,
      ContextManagementMethod.PREFIX_CACHE_AWARE,
      ContextManagementMethod.CHUNKED_RAG,
      ContextManagementMethod.SUMMARIZED,
      ContextManagementMethod.PROGRESSIVE
    ]

    for (const method of methods) {
      it(`returns empty result for ${method}`, async () => {
        const result = await manager.prepare('', {
          method,
          maxTokens: 1000,
          prompt: 'test'
        })

        expect(result.content).toBe('')
        expect(result.tokenCount).toBe(0)
        expect(result.truncated).toBe(false)
        expect(result.method).toBe(method)
      })
    }
  })

  // ── maxTokens <= 0 ───────────────────────────────────────────────────────────

  describe('maxTokens <= 0 returns empty result', () => {
    const methods = [
      ContextManagementMethod.FULL_INJECTION,
      ContextManagementMethod.PREFIX_CACHE_AWARE,
      ContextManagementMethod.SUMMARIZED,
      ContextManagementMethod.PROGRESSIVE
    ]

    for (const method of methods) {
      it(`returns empty result for ${method} when maxTokens=0`, async () => {
        const result = await manager.prepare('some content', {
          method,
          maxTokens: 0,
          prompt: 'test'
        })

        expect(result.content).toBe('')
        expect(result.tokenCount).toBe(0)
        expect(result.truncated).toBe(false)
        expect(result.method).toBe(method)
      })
    }
  })
})
