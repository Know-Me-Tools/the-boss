import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_SKILL_CONFIG,
  resolveSkillConfig,
  SkillSelectionMethod
} from '../../../../renderer/src/types/skillConfig'
import { MainSkillSelector } from '../MainSkillSelector'
import type { SkillDescriptor, SkillRegistry } from '../skillRegistry'

const { mockEmbed, mockCosineSimilarity } = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
  mockCosineSimilarity: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@main/apiServer/services/chat-completion', () => ({
  chatCompletionService: {
    processCompletion: vi.fn()
  }
}))

vi.mock('../MainEmbeddingResolver', () => ({
  MainEmbeddingResolver: class MockMainEmbeddingResolver {
    embed = mockEmbed
    cosineSimilarity = mockCosineSimilarity
  }
}))

function makeConfig() {
  const config = resolveSkillConfig(DEFAULT_SKILL_CONFIG)
  return resolveSkillConfig({
    ...config,
    selectionMethod: SkillSelectionMethod.EMBEDDING,
    methods: {
      ...config.methods,
      [SkillSelectionMethod.EMBEDDING]: {
        ...config.methods[SkillSelectionMethod.EMBEDDING],
        similarityThreshold: 0.1,
        topK: 3
      }
    }
  })
}

function makeSkill(id: string, description: string, triggerPatterns: RegExp[] = []): SkillDescriptor {
  return {
    id,
    name: id,
    description,
    triggerPatterns,
    getContent: () => `${id} content`,
    priority: 1
  }
}

function makeRegistry(): SkillRegistry {
  return {
    register: vi.fn(),
    getAll: vi.fn(),
    matchesTriggers: (skill: SkillDescriptor, prompt: string) =>
      skill.triggerPatterns.some((pattern) => pattern.test(prompt)),
    getMatchedTokens: (skill: SkillDescriptor, prompt: string) =>
      skill.triggerPatterns.flatMap((pattern) => prompt.match(pattern)?.[0] ?? [])
  } as unknown as SkillRegistry
}

const skills = [
  makeSkill('documentation', 'documentation planning workflow for project docs', [/documentation|docs|planning/i]),
  makeSkill('release', 'release notes and changelog preparation', [/release|changelog/i])
]

describe('MainSkillSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCosineSimilarity.mockReturnValue(0.5)
  })

  it('uses lexical fallback without calling embeddings when semantic selection is disabled', async () => {
    const selector = new MainSkillSelector(makeConfig(), makeRegistry())

    const selected = await selector.select('please use documentation planning', skills)

    expect(mockEmbed).not.toHaveBeenCalled()
    expect(selected[0]?.skill.id).toBe('documentation')
    expect(selected[0]?.selectionReason).toContain('lexical score')
  })

  it('falls back promptly when embedding selection hangs', async () => {
    mockEmbed.mockReturnValue(new Promise(() => {}))
    const selector = new MainSkillSelector(makeConfig(), makeRegistry(), undefined, {
      semanticSelectionEnabled: true,
      embeddingTimeoutMs: 20
    })

    const startedAt = Date.now()
    const selected = await selector.select('please use documentation planning', skills)

    expect(Date.now() - startedAt).toBeLessThan(1000)
    expect(mockEmbed).toHaveBeenCalled()
    expect(selected[0]?.skill.id).toBe('documentation')
    expect(selected[0]?.selectionReason).toContain('timed out')
  })

  it('falls back when embedding selection rejects', async () => {
    mockEmbed.mockRejectedValue(new Error('fastembed unavailable'))
    const selector = new MainSkillSelector(makeConfig(), makeRegistry(), undefined, {
      semanticSelectionEnabled: true,
      embeddingTimeoutMs: 100
    })

    const selected = await selector.select('please use documentation planning', skills)

    expect(mockEmbed).toHaveBeenCalled()
    expect(selected[0]?.skill.id).toBe('documentation')
    expect(selected[0]?.selectionReason).toContain('fastembed unavailable')
  })
})
