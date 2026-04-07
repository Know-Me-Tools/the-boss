import { loggerService } from '@logger'

const logger = loggerService.withContext('SkillEmbedText')

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
  const { embed } = await import('ai')
  const { fastembed } = await import('@mastra/fastembed')
  const { embedding } = await embed({ model: fastembed, value: text })
  return embedding
}
