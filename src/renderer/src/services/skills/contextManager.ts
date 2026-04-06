// src/renderer/src/services/skills/contextManager.ts
import { loggerService } from '@logger'
import { ContextManagementMethod } from '@renderer/types/skillConfig'

import type { EmbeddingResolver } from './embeddingResolver'

const logger = loggerService.withContext('ContextManager')

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextManagerOptions {
  method: ContextManagementMethod
  maxTokens: number
  prompt: string
  resolver?: EmbeddingResolver
}

export interface ManagedContext {
  content: string
  tokenCount: number
  method: ContextManagementMethod
  truncated: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Characters per token for the simple estimator. */
const CHARS_PER_TOKEN = 4

/** Chunk size in characters for CHUNKED_RAG (~200 tokens each). */
const CHUNK_SIZE_CHARS = 800

/** Preview token limit for PROGRESSIVE method. */
const PROGRESSIVE_PREVIEW_TOKENS = 256

const TRUNCATION_SUFFIX = '...[truncated]'

const SKILL_CONTEXT_OPEN = '<skill_context>\n'
const SKILL_CONTEXT_CLOSE = '\n</skill_context>'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function emptyResult(method: ContextManagementMethod): ManagedContext {
  return { content: '', tokenCount: 0, method, truncated: false }
}

// ─────────────────────────────────────────────────────────────────────────────
// ContextManager
// ─────────────────────────────────────────────────────────────────────────────

export class ContextManager {
  async prepare(rawContent: string, options: ContextManagerOptions): Promise<ManagedContext> {
    const { method, maxTokens, prompt, resolver } = options

    // Edge cases: empty content or non-positive budget
    if (!rawContent || maxTokens <= 0) {
      return emptyResult(method)
    }

    switch (method) {
      case ContextManagementMethod.FULL_INJECTION:
        return this.fullInjection(rawContent, maxTokens, method)

      case ContextManagementMethod.PREFIX_CACHE_AWARE:
        return this.prefixCacheAware(rawContent, maxTokens, method)

      case ContextManagementMethod.CHUNKED_RAG:
        return this.chunkedRag(rawContent, maxTokens, prompt, method, resolver)

      case ContextManagementMethod.SUMMARIZED:
        return this.summarized(rawContent, maxTokens, method)

      case ContextManagementMethod.PROGRESSIVE:
        return this.progressive(rawContent, method)

      default:
        return this.fullInjection(rawContent, maxTokens, method)
    }
  }

  // ── FULL_INJECTION ──────────────────────────────────────────────────────────

  private fullInjection(rawContent: string, maxTokens: number, method: ContextManagementMethod): ManagedContext {
    const budget = maxTokens * CHARS_PER_TOKEN

    if (rawContent.length <= budget) {
      return {
        content: rawContent,
        tokenCount: estimateTokens(rawContent),
        method,
        truncated: false
      }
    }

    const truncated = rawContent.slice(0, budget) + TRUNCATION_SUFFIX
    return {
      content: truncated,
      tokenCount: estimateTokens(truncated),
      method,
      truncated: true
    }
  }

  // ── PREFIX_CACHE_AWARE ──────────────────────────────────────────────────────

  private prefixCacheAware(rawContent: string, maxTokens: number, method: ContextManagementMethod): ManagedContext {
    const wrapperOverhead = estimateTokens(SKILL_CONTEXT_OPEN + SKILL_CONTEXT_CLOSE)
    const contentBudgetTokens = maxTokens - wrapperOverhead
    const contentBudgetChars = Math.max(0, contentBudgetTokens * CHARS_PER_TOKEN)

    let body = rawContent
    let wasTruncated = false

    if (rawContent.length > contentBudgetChars) {
      body = rawContent.slice(0, contentBudgetChars)
      wasTruncated = true
    }

    const wrapped = `${SKILL_CONTEXT_OPEN}${body}${SKILL_CONTEXT_CLOSE}`
    return {
      content: wrapped,
      tokenCount: estimateTokens(wrapped),
      method,
      truncated: wasTruncated
    }
  }

  // ── CHUNKED_RAG ─────────────────────────────────────────────────────────────

  private async chunkedRag(
    rawContent: string,
    maxTokens: number,
    prompt: string,
    method: ContextManagementMethod,
    resolver: EmbeddingResolver | undefined
  ): Promise<ManagedContext> {
    if (!resolver) {
      logger.warn('CHUNKED_RAG: no EmbeddingResolver provided; falling back to FULL_INJECTION')
      return this.fullInjection(rawContent, maxTokens, method)
    }

    // Split into ~200-token chunks (800 chars)
    const chunks: string[] = []
    for (let i = 0; i < rawContent.length; i += CHUNK_SIZE_CHARS) {
      chunks.push(rawContent.slice(i, i + CHUNK_SIZE_CHARS))
    }

    // defensive guard: unreachable given outer empty-content check
    if (chunks.length === 0) {
      return emptyResult(method)
    }

    // Embed prompt and all chunks
    const promptVec = await resolver.embed(prompt)
    const chunkEmbeddings = await Promise.all(chunks.map((c) => resolver.embed(c)))

    // Score each chunk by cosine similarity to prompt
    const scored = chunks.map((chunk, idx) => ({
      chunk,
      idx,
      score: resolver.cosineSimilarity(promptVec, chunkEmbeddings[idx])
    }))

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score)

    // Greedily fill budget
    const budget = maxTokens * CHARS_PER_TOKEN
    const selectedIndices: number[] = []
    let usedChars = 0

    for (const { chunk, idx } of scored) {
      if (usedChars + chunk.length > budget) break
      selectedIndices.push(idx)
      usedChars += chunk.length
    }

    // Restore original narrative order
    selectedIndices.sort((a, b) => a - b)

    const content = selectedIndices.map((i) => chunks[i]).join('\n\n')
    return {
      content,
      tokenCount: estimateTokens(content),
      method,
      truncated: selectedIndices.length < chunks.length
    }
  }

  // ── SUMMARIZED ──────────────────────────────────────────────────────────────

  private summarized(rawContent: string, maxTokens: number, method: ContextManagementMethod): ManagedContext {
    logger.warn('SUMMARIZED method using head-truncation; real summarization requires LLM')

    const prefix = '[Summary] '
    // Reserve chars for prefix; also reserve suffix chars when truncation will occur so
    // the final content stays within the token budget.
    const totalBudgetChars = maxTokens * CHARS_PER_TOKEN
    const maxBodyCharsWhenTruncated = totalBudgetChars - prefix.length - TRUNCATION_SUFFIX.length
    const maxBodyCharsWhenFull = totalBudgetChars - prefix.length

    const wasTruncated = estimateTokens(rawContent) > maxTokens
    const body = wasTruncated
      ? rawContent.slice(0, maxBodyCharsWhenTruncated) + TRUNCATION_SUFFIX
      : rawContent.slice(0, maxBodyCharsWhenFull)

    const content = prefix + body
    return {
      content,
      tokenCount: estimateTokens(content),
      method,
      truncated: wasTruncated
    }
  }

  // ── PROGRESSIVE ─────────────────────────────────────────────────────────────

  private progressive(rawContent: string, method: ContextManagementMethod): ManagedContext {
    const previewChars = PROGRESSIVE_PREVIEW_TOKENS * CHARS_PER_TOKEN
    const totalTokens = estimateTokens(rawContent)
    const isLong = totalTokens > PROGRESSIVE_PREVIEW_TOKENS

    if (!isLong) {
      return {
        content: rawContent,
        tokenCount: totalTokens,
        method,
        truncated: false
      }
    }

    const preview = rawContent.slice(0, previewChars)
    const content = preview + '\n[...full content available on request]'
    return {
      content,
      tokenCount: estimateTokens(content),
      method,
      truncated: true
    }
  }
}
