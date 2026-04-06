// src/renderer/src/services/skills/emitSkillChunks.ts
import { loggerService } from '@logger'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import type { SkillGlobalConfig } from '@renderer/types/skillConfig'

import type { ContextManagerOptions } from './contextManager'
import { ContextManager } from './contextManager'
import { skillRegistry } from './skillRegistry'
import { SkillSelector } from './skillSelector'

const logger = loggerService.withContext('emitSkillChunks')

/**
 * Runs skill selection and context management for the given prompt,
 * then emits SKILL_ACTIVATED / SKILL_CONTENT_DELTA / SKILL_COMPLETE chunks
 * through the provided stream processor function.
 *
 * Call this BEFORE the LLM request to inject skill context into the UI.
 */
export async function emitSkillChunks(params: {
  prompt: string
  config: SkillGlobalConfig
  processChunk: (chunk: Chunk) => void
}): Promise<void> {
  const { prompt, config, processChunk } = params

  const allSkills = skillRegistry.getAll()
  if (allSkills.length === 0) {
    logger.info('No skills registered, skipping skill selection')
    return
  }

  const selector = new SkillSelector(config)
  const results = await selector.select(prompt, allSkills)

  if (results.length === 0) {
    logger.info('No skills matched for prompt, skipping skill injection')
    return
  }

  const contextManager = new ContextManager()

  for (const result of results) {
    const rawContent = result.skill.getContent()

    const managed = await contextManager.prepare(rawContent, {
      method: config.contextManagementMethod,
      maxTokens: config.maxSkillTokens,
      prompt
    } as ContextManagerOptions)

    // 1. Emit SKILL_ACTIVATED
    processChunk({
      type: ChunkType.SKILL_ACTIVATED,
      skillId: result.skill.id,
      skillName: result.skill.name,
      triggerTokens: result.matchedKeywords,
      selectionReason: result.selectionReason,
      estimatedTokens: managed.tokenCount,
      content: managed.content,
      activationMethod: result.activationMethod,
      similarityScore: result.score,
      matchedKeywords: result.matchedKeywords,
      contextManagementMethod: config.contextManagementMethod
    })

    // 2. Emit SKILL_CONTENT_DELTA (stream content in chunks of ~100 chars)
    const DELTA_CHUNK_SIZE = 100
    for (let i = 0; i < managed.content.length; i += DELTA_CHUNK_SIZE) {
      processChunk({
        type: ChunkType.SKILL_CONTENT_DELTA,
        skillId: result.skill.id,
        delta: managed.content.slice(i, i + DELTA_CHUNK_SIZE)
      })
    }

    // 3. Emit SKILL_COMPLETE
    processChunk({
      type: ChunkType.SKILL_COMPLETE,
      skillId: result.skill.id,
      finalTokenCount: managed.tokenCount
    })

    logger.info('Emitted skill chunks', {
      skillId: result.skill.id,
      skillName: result.skill.name,
      tokenCount: managed.tokenCount,
      method: config.contextManagementMethod
    })
  }
}
