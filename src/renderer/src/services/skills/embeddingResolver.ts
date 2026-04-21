// src/renderer/src/services/skills/embeddingResolver.ts
import { loggerService } from '@logger'
import type { ApiClient } from '@renderer/types'

const logger = loggerService.withContext('EmbeddingResolver')

export type EmbeddingResolverConfig = {
  modelId?: string
  apiClient?: ApiClient
}

/**
 * Resolves embeddings for skill descriptions and user prompts.
 * Embeddings run in the main process (`window.api.embedText`) because local fastembed uses native Node addons.
 * When `apiClient` is provided, the main process routes to that provider's embedding API instead of fastembed.
 */
export class EmbeddingResolver {
  private readonly modelId: string | undefined
  private readonly apiClient: ApiClient | undefined

  constructor(config?: EmbeddingResolverConfig | string) {
    if (typeof config === 'string' || config === undefined) {
      this.modelId = config
      this.apiClient = undefined
    } else {
      this.modelId = config.modelId
      this.apiClient = config.apiClient
    }
  }

  async embed(text: string): Promise<number[]> {
    const embedText = window.api?.embedText
    if (!embedText) {
      logger.error('window.api.embedText is not available')
      throw new Error('Embedding is unavailable')
    }
    try {
      const result = await embedText({ modelId: this.modelId, apiClient: this.apiClient, text })
      if (Array.isArray(result) && result.length > 0) {
        return result
      }
    } catch (err) {
      logger.warn('embedText failed', err as Error)
      throw err
    }
    throw new Error('Embedding returned an empty vector')
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const embedTextsBatch = window.api?.embedTextsBatch
    if (embedTextsBatch) {
      try {
        const results = await embedTextsBatch({ modelId: this.modelId, apiClient: this.apiClient, texts })
        if (Array.isArray(results) && results.length === texts.length) {
          return results
        }
      } catch (err) {
        logger.warn('embedTextsBatch failed, falling back to sequential', err as Error)
      }
    }
    // Fallback: sequential embeds
    return Promise.all(texts.map((text) => this.embed(text)))
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vector length mismatch')
    }
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
