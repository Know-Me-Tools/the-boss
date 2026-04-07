import { loggerService } from '@logger'
import { ContextManagementMethod } from '@types'

const logger = loggerService.withContext('MainContextManager')

export interface ContextManagerOptions {
  method: ContextManagementMethod
  maxTokens: number
  prompt: string
  resolver?: {
    embed: (text: string) => Promise<number[]>
    cosineSimilarity: (left: number[], right: number[]) => number
  }
}

export interface ManagedContext {
  content: string
  tokenCount: number
  method: ContextManagementMethod
  truncated: boolean
}

const CHARS_PER_TOKEN = 4
const CHUNK_SIZE_CHARS = 800
const PROGRESSIVE_PREVIEW_TOKENS = 256
const TRUNCATION_SUFFIX = '...[truncated]'
const SKILL_CONTEXT_OPEN = '<skill_context>\n'
const SKILL_CONTEXT_CLOSE = '\n</skill_context>'

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function emptyResult(method: ContextManagementMethod): ManagedContext {
  return { content: '', tokenCount: 0, method, truncated: false }
}

export class ContextManager {
  async prepare(rawContent: string, options: ContextManagerOptions): Promise<ManagedContext> {
    const { method, maxTokens, prompt, resolver } = options
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

  private async chunkedRag(
    rawContent: string,
    maxTokens: number,
    prompt: string,
    method: ContextManagementMethod,
    resolver: ContextManagerOptions['resolver']
  ): Promise<ManagedContext> {
    if (!resolver) {
      logger.warn('CHUNKED_RAG: no resolver provided; falling back to FULL_INJECTION')
      return this.fullInjection(rawContent, maxTokens, method)
    }

    const chunks: string[] = []
    for (let index = 0; index < rawContent.length; index += CHUNK_SIZE_CHARS) {
      chunks.push(rawContent.slice(index, index + CHUNK_SIZE_CHARS))
    }
    if (chunks.length === 0) {
      return emptyResult(method)
    }

    const promptVector = await resolver.embed(prompt)
    const chunkEmbeddings = await Promise.all(chunks.map((chunk) => resolver.embed(chunk)))
    const scored = chunks.map((chunk, index) => ({
      chunk,
      index,
      score: resolver.cosineSimilarity(promptVector, chunkEmbeddings[index])
    }))

    scored.sort((left, right) => right.score - left.score)

    const budget = maxTokens * CHARS_PER_TOKEN
    const selectedIndices: number[] = []
    let usedChars = 0

    for (const { chunk, index } of scored) {
      if (usedChars + chunk.length > budget) {
        break
      }
      selectedIndices.push(index)
      usedChars += chunk.length
    }

    selectedIndices.sort((left, right) => left - right)
    const content = selectedIndices.map((index) => chunks[index]).join('\n\n')

    return {
      content,
      tokenCount: estimateTokens(content),
      method,
      truncated: selectedIndices.length < chunks.length
    }
  }

  private summarized(rawContent: string, maxTokens: number, method: ContextManagementMethod): ManagedContext {
    logger.warn('SUMMARIZED method using head-truncation; real summarization requires LLM')

    const prefix = '[Summary] '
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

  private progressive(rawContent: string, method: ContextManagementMethod): ManagedContext {
    const previewChars = PROGRESSIVE_PREVIEW_TOKENS * CHARS_PER_TOKEN
    const totalTokens = estimateTokens(rawContent)
    if (totalTokens <= PROGRESSIVE_PREVIEW_TOKENS) {
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
