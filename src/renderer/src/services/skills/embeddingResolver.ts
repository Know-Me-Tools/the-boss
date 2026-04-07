// src/renderer/src/services/skills/embeddingResolver.ts
import { loggerService } from '@logger'

const logger = loggerService.withContext('EmbeddingResolver')

/**
 * Resolves embeddings for skill descriptions and user prompts.
 * Embeddings run in the main process (`window.api.embedText`) because local fastembed uses native Node addons.
 */
export class EmbeddingResolver {
  private readonly modelId: string | undefined

  constructor(modelId?: string) {
    this.modelId = modelId
  }

  async embed(text: string): Promise<number[]> {
    const embedText = window.api?.embedText
    if (!embedText) {
      logger.error('window.api.embedText is not available')
      throw new Error('Embedding is unavailable')
    }
    try {
      const result = await embedText({ modelId: this.modelId, text })
      if (Array.isArray(result) && result.length > 0) {
        return result
      }
    } catch (err) {
      logger.warn('embedText failed', err as Error)
      throw err
    }
    throw new Error('Embedding returned an empty vector')
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
