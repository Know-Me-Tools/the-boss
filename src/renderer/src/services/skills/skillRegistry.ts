// src/renderer/src/services/skills/skillRegistry.ts

/**
 * Skill descriptor and registry for the skill selection pipeline.
 * Register SkillDescriptors here to make them eligible for selection.
 */

export interface SkillDescriptor {
  /** Unique identifier used in chunk payloads and block state */
  id: string
  /** Display name shown in the SkillBlock UI */
  name: string
  /** Used as selectionReason in the UI and as the embedding text for semantic matching */
  description: string
  /** Regex patterns matched against user prompt for keyword-based methods */
  triggerPatterns: RegExp[]
  /** Returns the full text to inject into the LLM context */
  getContent: () => string
  /** Higher priority skills are selected first when topK limit applies */
  priority: number
}

export class SkillRegistry {
  private skills: SkillDescriptor[] = []

  register(skill: SkillDescriptor): void {
    this.skills.push(skill)
    this.skills.sort((a, b) => b.priority - a.priority)
  }

  getAll(): SkillDescriptor[] {
    return [...this.skills]
  }

  matchesTriggers(skill: SkillDescriptor, prompt: string): boolean {
    return skill.triggerPatterns.some((pattern) => pattern.test(prompt))
  }

  /** Returns the matched substrings for all patterns that fire against the prompt */
  getMatchedTokens(skill: SkillDescriptor, prompt: string): string[] {
    const tokens: string[] = []
    for (const pattern of skill.triggerPatterns) {
      const match = prompt.match(pattern)
      if (match) tokens.push(match[0])
    }
    return tokens
  }
}

/** Module-level singleton registry — import and call .register() to add skills */
export const skillRegistry = new SkillRegistry()
