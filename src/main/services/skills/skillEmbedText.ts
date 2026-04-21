import { loggerService } from '@logger'

const logger = loggerService.withContext('SkillEmbedText')

/**
 * Cached fastembed model instance. Initialized once on first use to avoid repeated
 * ONNX session creation (each FlagEmbedding.init() is ~1-2s and CPU-intensive).
 */
let fastembedModelPromise: Promise<import('fastembed').FlagEmbedding> | null = null

async function getFastembedModel(): Promise<import('fastembed').FlagEmbedding> {
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
      // Reset on failure so the next call can retry
      fastembedModelPromise = null
    })
  }
  return fastembedModelPromise
}

/**
 * Runs skill semantic embeddings in the main process. `@mastra/fastembed` depends on
 * native Node addons and must not be imported from the renderer/Vite bundle.
 *
 * When `modelId` is set, a provider-specific path can be added later; until then we use fastembed.
 */
export async function embedTextInMainProcess(payload: { modelId?: string; text: string }): Promise<number[]> {
  const text = typeof payload?.text === 'string' ? payload.text : ''
  if (!text.trim()) {
    return []
  }
  if (payload.modelId) {
    logger.debug('Skill embed: modelId present; using fastembed until provider path is wired', {
      modelId: payload.modelId
    })
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
 * Batch-embeds multiple texts in a single ONNX inference pass. Significantly faster
 * than calling embedTextInMainProcess for each text individually when scoring many skills.
 */
export async function embedTextsBatchInMainProcess(payload: {
  modelId?: string
  texts: string[]
}): Promise<number[][]> {
  const texts = Array.isArray(payload?.texts) ? payload.texts.filter((t) => typeof t === 'string' && t.trim()) : []
  if (texts.length === 0) {
    return []
  }
  if (payload.modelId) {
    logger.debug('Skill batch embed: modelId present; using fastembed until provider path is wired', {
      modelId: payload.modelId
    })
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
