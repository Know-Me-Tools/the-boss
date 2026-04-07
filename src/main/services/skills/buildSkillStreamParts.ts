import { loggerService } from '@logger'
import type { SkillGlobalConfig } from '@types'
import type { TextStreamPart } from 'ai'

import { ContextManager } from './contextManager'
import { MainSkillSelector } from './MainSkillSelector'
import { skillRegistry } from './skillRegistry'

const logger = loggerService.withContext('BuildSkillStreamParts')

function estimateRawTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

export async function buildSkillStreamParts(params: {
  prompt: string
  config: SkillGlobalConfig
  activeModel?: string
}): Promise<Array<TextStreamPart<Record<string, any>>>> {
  const { prompt, config, activeModel } = params
  const allSkills = skillRegistry.getAll()

  if (allSkills.length === 0) {
    return []
  }

  const selector = new MainSkillSelector(config, skillRegistry, activeModel)
  const selectedSkills = await selector.select(prompt, allSkills)
  if (selectedSkills.length === 0) {
    return []
  }

  const contextManager = new ContextManager()
  const parts: Array<TextStreamPart<Record<string, any>>> = []

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
    } catch (error) {
      logger.error(`Failed to build skill stream parts for ${result.skill.id}`, error as Error)
    }
  }

  return parts
}
