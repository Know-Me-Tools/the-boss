import { loggerService } from '@logger'
import type { SkillGlobalConfig } from '@types'
import type { TextStreamPart } from 'ai'

import { ContextManager } from './contextManager'
import { MainSkillSelector } from './MainSkillSelector'
import type { SkillDescriptor, SkillRegistry } from './skillRegistry'
import { SkillRegistry as SkillRegistryClass, skillRegistry as defaultRegistry } from './skillRegistry'

const logger = loggerService.withContext('BuildSkillStreamParts')

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

export async function buildSkillStreamParts(params: {
  prompt: string
  config: SkillGlobalConfig
  activeModel?: string
  skills?: SkillDescriptor[]
  registry?: SkillRegistry
  onPreparedSkills?: (skills: PreparedSkillContext[]) => void
  disabled?: boolean
}): Promise<Array<TextStreamPart<Record<string, any>>>> {
  const { prompt, config, activeModel } = params

  if (params.disabled) {
    logger.info('Skipping backend skill selection for this request')
    return []
  }

  const registry = params.registry ?? buildRegistry(params.skills)
  const allSkills = params.skills ?? registry.getAll()

  if (allSkills.length === 0) {
    return []
  }

  const selector = new MainSkillSelector(config, registry, activeModel)
  const selectedSkills = await selector.select(prompt, allSkills)
  if (selectedSkills.length === 0) {
    return []
  }

  const contextManager = new ContextManager()
  const parts: Array<TextStreamPart<Record<string, any>>> = []
  const preparedSkills: PreparedSkillContext[] = []

  for (const result of selectedSkills) {
    try {
      const rawContent = result.skill.getContent()
      const managed = await contextManager.prepare(rawContent, {
        method: config.contextManagementMethod,
        maxTokens: config.maxSkillTokens,
        prompt
      })

      parts.push({
        type: 'data-skill-activated',
        data: {
          skillId: result.skill.id,
          skillName: result.skill.name,
          triggerTokens: result.matchedKeywords,
          selectionReason: result.selectionReason,
          activationMethod: result.activationMethod,
          similarityScore: result.score,
          matchedKeywords: result.matchedKeywords,
          contextManagementMethod: config.contextManagementMethod,
          content: managed.content,
          originalTokenCount: estimateRawTokenCount(rawContent),
          managedTokenCount: managed.tokenCount,
          tokensSaved: Math.max(0, estimateRawTokenCount(rawContent) - managed.tokenCount),
          truncated: managed.truncated
        }
      } as unknown as TextStreamPart<Record<string, any>>)

      for (let index = 0; index < managed.content.length; index += 100) {
        parts.push({
          type: 'data-skill-content-delta',
          data: {
            skillId: result.skill.id,
            delta: managed.content.slice(index, index + 100)
          }
        } as unknown as TextStreamPart<Record<string, any>>)
      }

      parts.push({
        type: 'data-skill-complete',
        data: {
          skillId: result.skill.id,
          finalTokenCount: managed.tokenCount
        }
      } as unknown as TextStreamPart<Record<string, any>>)

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
    } catch (error) {
      logger.error(`Failed to build skill stream parts for ${result.skill.id}`, error as Error)
    }
  }

  params.onPreparedSkills?.(preparedSkills)
  return parts
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
