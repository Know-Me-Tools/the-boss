import { loggerService } from '@logger'

const logger = loggerService.withContext('MainSkillRegistry')

export interface SkillDescriptor {
  id: string
  name: string
  description: string
  triggerPatterns: RegExp[]
  getContent: () => string
  priority: number
}

export class SkillRegistry {
  private skills: SkillDescriptor[] = []

  register(skill: SkillDescriptor): void {
    if (this.skills.some((entry) => entry.id === skill.id)) {
      logger.warn('Duplicate skill id registered in main registry, skipping', { id: skill.id })
      return
    }
    this.skills.push(skill)
    this.skills.sort((left, right) => right.priority - left.priority)
  }

  getAll(): SkillDescriptor[] {
    return [...this.skills]
  }

  matchesTriggers(skill: SkillDescriptor, prompt: string): boolean {
    return skill.triggerPatterns.some((pattern) => pattern.test(prompt))
  }

  getMatchedTokens(skill: SkillDescriptor, prompt: string): string[] {
    const tokens: string[] = []
    for (const pattern of skill.triggerPatterns) {
      const match = prompt.match(pattern)
      if (match) {
        tokens.push(match[0])
      }
    }
    return tokens
  }
}

export const skillRegistry = new SkillRegistry()
