// src/renderer/src/services/skills/emitSkillChunks.ts
import { loggerService } from '@logger'
import type { Model } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import type { SkillGlobalConfig } from '@renderer/types/skillConfig'

import { ContextManager } from './contextManager'
import type { SkillDescriptor, SkillRegistry } from './skillRegistry'
import { SkillRegistry as SkillRegistryClass, skillRegistry as defaultRegistry } from './skillRegistry'
import { SkillSelector } from './skillSelector'

const logger = loggerService.withContext('emitSkillChunks')

function estimateRawTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

export interface PreparedSkillContext {
  skillId: string
  skillName: string
  content: string
  activationMethod: string
  selectionReason: string
  similarityScore: number
  matchedKeywords: string[]
  contextManagementMethod: string
  originalTokenCount: number
  managedTokenCount: number
  tokensSaved: number
  truncated: boolean
}

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
  activeModel?: Model | string
  skills?: SkillDescriptor[]
  registry?: SkillRegistry
  disabled?: boolean
}): Promise<PreparedSkillContext[]> {
  const { prompt, config, processChunk, activeModel } = params

  if (params.disabled) {
    logger.info('Skipping skill selection for this request')
    return []
  }

  const registry = params.registry ?? buildRegistry(params.skills)
  const allSkills = params.skills ?? registry.getAll()
  if (allSkills.length === 0) {
    logger.info('No skills registered, skipping skill selection')
    return []
  }

  const selector = new SkillSelector(config, undefined, registry, undefined, activeModel)
  const results = await selector.select(prompt, allSkills)

  if (results.length === 0) {
    logger.info('No skills matched for prompt, skipping skill injection')
    return []
  }

  const contextManager = new ContextManager()
  const preparedSkills: PreparedSkillContext[] = []

  for (const result of results) {
    try {
      const rawContent = result.skill.getContent()

      const managed = await contextManager.prepare(rawContent, {
        method: config.contextManagementMethod,
        maxTokens: config.maxSkillTokens,
        prompt
      })

      // 1. Emit SKILL_ACTIVATED
      processChunk({
        type: ChunkType.SKILL_ACTIVATED,
        skillId: result.skill.id,
        skillName: result.skill.name,
        triggerTokens: result.matchedKeywords,
        selectionReason: result.selectionReason,
        content: managed.content,
        activationMethod: result.activationMethod,
        similarityScore: result.score,
        matchedKeywords: result.matchedKeywords,
        contextManagementMethod: config.contextManagementMethod,
        originalTokenCount: estimateRawTokenCount(rawContent),
        managedTokenCount: managed.tokenCount,
        tokensSaved: Math.max(0, estimateRawTokenCount(rawContent) - managed.tokenCount),
        truncated: managed.truncated
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

      preparedSkills.push({
        skillId: result.skill.id,
        skillName: result.skill.name,
        content: managed.content,
        activationMethod: result.activationMethod,
        selectionReason: result.selectionReason,
        similarityScore: result.score,
        matchedKeywords: result.matchedKeywords,
        contextManagementMethod: config.contextManagementMethod,
        originalTokenCount: estimateRawTokenCount(rawContent),
        managedTokenCount: managed.tokenCount,
        tokensSaved: Math.max(0, estimateRawTokenCount(rawContent) - managed.tokenCount),
        truncated: managed.truncated
      })

      logger.info('Emitted skill chunks', {
        skillId: result.skill.id,
        skillName: result.skill.name,
        tokenCount: managed.tokenCount,
        method: config.contextManagementMethod
      })
    } catch (err) {
      logger.error(`Failed to prepare/emit skill '${result.skill.id}', skipping`, err as Error)
      // Continue with next skill, don't abort
    }
  }

  return preparedSkills
}

function buildRegistry(skills: SkillDescriptor[] | undefined): SkillRegistry {
  if (!skills) {
    return defaultRegistry
  }

  const registry = new SkillRegistryClass()
  for (const skill of skills) {
    registry.register(skill)
  }
  return registry
}
