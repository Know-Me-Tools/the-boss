// src/renderer/src/services/skills/__tests__/skillRegistry.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SkillRegistry } from '../skillRegistry'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    })
  }
}))

describe('SkillRegistry', () => {
  let registry: SkillRegistry

  beforeEach(() => {
    registry = new SkillRegistry()
  })

  it('starts empty', () => {
    expect(registry.getAll()).toHaveLength(0)
  })

  it('registers and retrieves a skill sorted by priority descending', () => {
    registry.register({
      id: 'low-priority',
      name: 'Low',
      description: 'low',
      triggerPatterns: [],
      getContent: () => 'low',
      priority: 1
    })
    registry.register({
      id: 'high-priority',
      name: 'High',
      description: 'high',
      triggerPatterns: [],
      getContent: () => 'high',
      priority: 10
    })
    const all = registry.getAll()
    expect(all[0].id).toBe('high-priority')
    expect(all[1].id).toBe('low-priority')
  })

  it('matchesTriggers returns true when any pattern matches', () => {
    registry.register({
      id: 'agent-skill',
      name: 'Agent',
      description: 'agent patterns',
      triggerPatterns: [/\bagent\b/i, /\bstreaming\b/i],
      getContent: () => 'content',
      priority: 5
    })
    const skill = registry.getAll()[0]
    expect(registry.matchesTriggers(skill, 'tell me about agent streaming')).toBe(true)
    expect(registry.matchesTriggers(skill, 'something else entirely')).toBe(false)
  })

  it('getMatchedTokens returns all matched strings', () => {
    registry.register({
      id: 's',
      name: 'S',
      description: 'd',
      triggerPatterns: [/\bstreaming\b/i, /\bAG-UI\b/i],
      getContent: () => '',
      priority: 1
    })
    const skill = registry.getAll()[0]
    const matched = registry.getMatchedTokens(skill, 'streaming AG-UI events')
    expect(matched).toContain('streaming')
    expect(matched).toContain('AG-UI')
  })

  it('getMatchedTokens returns empty array when nothing matches', () => {
    registry.register({
      id: 's',
      name: 'S',
      description: 'd',
      triggerPatterns: [/\bspecific\b/i],
      getContent: () => '',
      priority: 1
    })
    const skill = registry.getAll()[0]
    expect(registry.getMatchedTokens(skill, 'no match here')).toEqual([])
  })

  it('silently skips registration when a duplicate id is provided', () => {
    const skill = {
      id: 'dup',
      name: 'Original',
      description: 'original',
      triggerPatterns: [],
      getContent: () => 'original',
      priority: 5
    }
    registry.register(skill)
    registry.register({
      ...skill,
      name: 'Duplicate',
      description: 'duplicate',
      getContent: () => 'duplicate'
    })
    const all = registry.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('Original')
  })
})
