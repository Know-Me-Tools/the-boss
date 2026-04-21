import { loggerService } from '@logger'

import { embedTextInMainProcess, embedTextsBatchInMainProcess } from './skillEmbedText'

const logger = loggerService.withContext('MainEmbeddingResolver')

export class MainEmbeddingResolver {
  private readonly modelId: string | undefined

  constructor(modelId?: string) {
    this.modelId = modelId
  }

  async embed(text: string): Promise<number[]> {
    try {
      const vector = await embedTextInMainProcess({ modelId: this.modelId, text })
      if (Array.isArray(vector) && vector.length > 0) {
        return vector
      }
    } catch (error) {
      logger.warn('Skill embed failed in main process', error as Error)
      throw error
    }

    throw new Error('Embedding returned an empty vector')
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const vectors = await embedTextsBatchInMainProcess({ modelId: this.modelId, texts })
      if (Array.isArray(vectors) && vectors.length === texts.length) {
        return vectors
      }
    } catch (error) {
      logger.warn('Skill batch embed failed, falling back to sequential', error as Error)
    }
    return Promise.all(texts.map((text) => this.embed(text)))
  }

  cosineSimilarity(left: number[], right: number[]): number {
    if (left.length !== right.length) {
      throw new Error('Vector length mismatch')
    }

    let dot = 0
    let leftNorm = 0
    let rightNorm = 0

    for (let index = 0; index < left.length; index += 1) {
      dot += left[index] * right[index]
      leftNorm += left[index] * left[index]
      rightNorm += right[index] * right[index]
    }

    const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm)
    return denominator === 0 ? 0 : dot / denominator
  }
}
