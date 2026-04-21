import { loggerService } from '@logger'
import EmbeddingsFactory from '@main/knowledge/embedjs/embeddings/EmbeddingsFactory'
import type { ApiClient } from '@types'
import type { FlagEmbedding } from 'fastembed'

const logger = loggerService.withContext('SkillEmbedText')

/**
 * Cached fastembed model instance. Initialized once on first use to avoid repeated
 * ONNX session creation (each FlagEmbedding.init() is ~1-2s and CPU-intensive).
 */
let fastembedModelPromise: Promise<FlagEmbedding> | null = null

async function getFastembedModel(): Promise<FlagEmbedding> {
  if (!fastembedModelPromise) {
    fastembedModelPromise = (async () => {
      const { FlagEmbedding, EmbeddingModel } = await import('fastembed')
      const fsp = await import('fs/promises')
      const os = await import('os')
      const path = await import('path')
      const cachePath = path.join(os.homedir(), '.cache', 'mastra', 'fastembed-models')
      await fsp.mkdir(cachePath, { recursive: true })
      return FlagEmbedding.init({ model: EmbeddingModel.BGESmallENV15, cacheDir: cachePath })
    })()
    fastembedModelPromise.catch(() => {
      fastembedModelPromise = null
    })
  }
  return fastembedModelPromise
}

async function embedViaProvider(apiClient: ApiClient, texts: string[]): Promise<number[][]> {
  const embeddings = EmbeddingsFactory.create({ embedApiClient: apiClient })
  await embeddings.init()
  return embeddings.embedDocuments(texts)
}

/**
 * Runs skill semantic embeddings in the main process.
 * When `apiClient` is provided, routes to that provider's embedding API.
 * Otherwise falls back to local fastembed (BGE-small-en-v1.5 ONNX).
 */
export async function embedTextInMainProcess(payload: {
  modelId?: string
  apiClient?: ApiClient
  text: string
}): Promise<number[]> {
  const text = typeof payload?.text === 'string' ? payload.text : ''
  if (!text.trim()) {
    return []
  }

  if (payload.apiClient) {
    const results = await embedViaProvider(payload.apiClient, [text])
    if (results.length > 0) {
      return results[0]
    }
    throw new Error('Provider embedding returned empty result')
  }

  const model = await getFastembedModel()
  const embeddings = model.embed([text])
  for await (const batch of embeddings) {
    if (batch.length > 0) {
      return Array.from(batch[0])
    }
  }
  throw new Error('Embedding returned an empty vector')
}

/**
 * Batch-embeds multiple texts in a single inference pass.
 * When `apiClient` is provided, routes to that provider's embedding API.
 * Otherwise uses local fastembed ONNX for a single-pass batch inference.
 */
export async function embedTextsBatchInMainProcess(payload: {
  modelId?: string
  apiClient?: ApiClient
  texts: string[]
}): Promise<number[][]> {
  const texts = Array.isArray(payload?.texts) ? payload.texts.filter((t) => typeof t === 'string' && t.trim()) : []
  if (texts.length === 0) {
    return []
  }

  if (payload.apiClient) {
    logger.debug('Skill batch embed via provider', {
      provider: payload.apiClient.provider,
      model: payload.apiClient.model
    })
    return embedViaProvider(payload.apiClient, texts)
  }

  const model = await getFastembedModel()
  const embeddings = model.embed(texts)
  const results: number[][] = []
  for await (const batch of embeddings) {
    for (const vec of batch) {
      results.push(Array.from(vec))
    }
  }
  return results
}
