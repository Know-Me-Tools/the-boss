// src/renderer/src/services/skills/embeddingResolver.ts
import { loggerService } from '@logger'

const logger = loggerService.withContext('EmbeddingResolver')

/**
 * Resolves embeddings for skill descriptions and user prompts.
 * Priority chain: configured model via window.api → fastembed (local WASM, no API key needed).
 */
export class EmbeddingResolver {
  private readonly modelId: string | undefined

  constructor(modelId?: string) {
    this.modelId = modelId
  }

  async embed(text: string): Promise<number[]> {
    if (this.modelId) {
      try {
        const result = await (window as any).api?.embedText?.({ modelId: this.modelId, text })
        if (Array.isArray(result) && result.length > 0) return result
      } catch (err) {
        logger.warn('Configured embedding model failed, falling back to fastembed', err)
      }
    }
    return this.fastEmbed(text)
  }

  private async fastEmbed(text: string): Promise<number[]> {
    const { EmbedMany } = await import('@mastra/fastembed')
    const results = await EmbedMany([text])
    return results[0]
  }

  cosineSimilarity(a: number[], b: number[]): number {
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
