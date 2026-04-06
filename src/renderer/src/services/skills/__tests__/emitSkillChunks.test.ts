// src/renderer/src/services/skills/__tests__/emitSkillChunks.test.ts
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import type { SkillGlobalConfig } from '@renderer/types/skillConfig'
import { ContextManagementMethod, SkillSelectionMethod } from '@renderer/types/skillConfig'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mock functions (must be defined before vi.mock factories run)
// ─────────────────────────────────────────────────────────────────────────────

const { mockGetAll, mockSelect, mockPrepare } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockSelect: vi.fn(),
  mockPrepare: vi.fn()
}))

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('../skillRegistry', () => ({
  skillRegistry: {
    getAll: mockGetAll
  }
}))

vi.mock('../skillSelector', () => ({
  SkillSelector: vi.fn().mockImplementation(() => ({
    select: mockSelect
  }))
}))

vi.mock('../contextManager', () => ({
  ContextManager: vi.fn().mockImplementation(() => ({
    prepare: mockPrepare
  }))
}))

// Import AFTER mocks are registered
import { emitSkillChunks } from '../emitSkillChunks'

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<SkillGlobalConfig> = {}): SkillGlobalConfig {
  return {
    selectionMethod: SkillSelectionMethod.EMBEDDING,
    similarityThreshold: 0.35,
    topK: 3,
    contextManagementMethod: ContextManagementMethod.FULL_INJECTION,
    maxSkillTokens: 4096,
    ...overrides
  }
}

function makeSkillDescriptor(id: string, content = `content of ${id}`) {
  return {
    id,
    name: `Skill ${id}`,
    description: `Description for ${id}`,
    triggerPatterns: [],
    getContent: () => content,
    priority: 5
  }
}

function makeSelectorResult(skillId: string, content = `content of ${skillId}`) {
  return {
    skill: makeSkillDescriptor(skillId, content),
    score: 0.8,
    matchedKeywords: ['keyword1'],
    selectionReason: `Semantic similarity: 0.80`,
    activationMethod: SkillSelectionMethod.EMBEDDING
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('emitSkillChunks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when registry is empty', async () => {
    mockGetAll.mockReturnValue([])
    const processChunk = vi.fn()

    await emitSkillChunks({ prompt: 'hello', config: makeConfig(), processChunk })

    expect(processChunk).not.toHaveBeenCalled()
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('does nothing when no skills match', async () => {
    mockGetAll.mockReturnValue([makeSkillDescriptor('skill-a')])
    mockSelect.mockResolvedValue([])
    const processChunk = vi.fn()

    await emitSkillChunks({ prompt: 'hello', config: makeConfig(), processChunk })

    expect(processChunk).not.toHaveBeenCalled()
  })

  it('emits ACTIVATED → DELTA(s) → COMPLETE for each matched skill', async () => {
    const content = 'abc' // 3 chars → 1 delta chunk (< 100)
    mockGetAll.mockReturnValue([makeSkillDescriptor('skill-a')])
    mockSelect.mockResolvedValue([makeSelectorResult('skill-a', content)])
    mockPrepare.mockResolvedValue({
      content,
      tokenCount: 1,
      method: ContextManagementMethod.FULL_INJECTION,
      truncated: false
    })

    const chunks: Chunk[] = []
    await emitSkillChunks({
      prompt: 'test prompt',
      config: makeConfig(),
      processChunk: (c) => chunks.push(c)
    })

    // Should have: SKILL_ACTIVATED, 1× SKILL_CONTENT_DELTA, SKILL_COMPLETE
    expect(chunks).toHaveLength(3)
    expect(chunks[0].type).toBe(ChunkType.SKILL_ACTIVATED)
    expect(chunks[1].type).toBe(ChunkType.SKILL_CONTENT_DELTA)
    expect(chunks[2].type).toBe(ChunkType.SKILL_COMPLETE)
  })

  it('emits multiple DELTA chunks when content exceeds 100 chars', async () => {
    const content = 'x'.repeat(250) // 250 chars → 3 delta chunks (100 + 100 + 50)
    mockGetAll.mockReturnValue([makeSkillDescriptor('skill-b')])
    mockSelect.mockResolvedValue([makeSelectorResult('skill-b', content)])
    mockPrepare.mockResolvedValue({
      content,
      tokenCount: 63,
      method: ContextManagementMethod.FULL_INJECTION,
      truncated: false
    })

    const chunks: Chunk[] = []
    await emitSkillChunks({
      prompt: 'test',
      config: makeConfig(),
      processChunk: (c) => chunks.push(c)
    })

    const deltaChunks = chunks.filter((c) => c.type === ChunkType.SKILL_CONTENT_DELTA)
    expect(deltaChunks).toHaveLength(3)
  })

  it('emits correct skill metadata in SKILL_ACTIVATED chunk', async () => {
    const content = 'some content'
    const config = makeConfig({ contextManagementMethod: ContextManagementMethod.PREFIX_CACHE_AWARE })
    const selectorResult = {
      ...makeSelectorResult('skill-z', content),
      score: 0.92,
      matchedKeywords: ['foo', 'bar'],
      selectionReason: 'Semantic similarity: 0.92',
      activationMethod: SkillSelectionMethod.EMBEDDING
    }
    mockGetAll.mockReturnValue([makeSkillDescriptor('skill-z', content)])
    mockSelect.mockResolvedValue([selectorResult])
    mockPrepare.mockResolvedValue({
      content,
      tokenCount: 3,
      method: ContextManagementMethod.PREFIX_CACHE_AWARE,
      truncated: false
    })

    const chunks: Chunk[] = []
    await emitSkillChunks({
      prompt: 'test',
      config,
      processChunk: (c) => chunks.push(c)
    })

    const activatedChunk = chunks.find((c) => c.type === ChunkType.SKILL_ACTIVATED) as any
    expect(activatedChunk.skillId).toBe('skill-z')
    expect(activatedChunk.skillName).toBe('Skill skill-z')
    expect(activatedChunk.triggerTokens).toEqual(['foo', 'bar'])
    expect(activatedChunk.selectionReason).toBe('Semantic similarity: 0.92')
    expect(activatedChunk.estimatedTokens).toBe(3)
    expect(activatedChunk.content).toBe(content)
    expect(activatedChunk.activationMethod).toBe(SkillSelectionMethod.EMBEDDING)
    expect(activatedChunk.similarityScore).toBe(0.92)
    expect(activatedChunk.matchedKeywords).toEqual(['foo', 'bar'])
    expect(activatedChunk.contextManagementMethod).toBe(ContextManagementMethod.PREFIX_CACHE_AWARE)
  })

  it('emits correct finalTokenCount in SKILL_COMPLETE', async () => {
    const content = 'hello world'
    mockGetAll.mockReturnValue([makeSkillDescriptor('skill-c')])
    mockSelect.mockResolvedValue([makeSelectorResult('skill-c', content)])
    mockPrepare.mockResolvedValue({
      content,
      tokenCount: 42,
      method: ContextManagementMethod.FULL_INJECTION,
      truncated: false
    })

    const chunks: Chunk[] = []
    await emitSkillChunks({
      prompt: 'test',
      config: makeConfig(),
      processChunk: (c) => chunks.push(c)
    })

    const completeChunk = chunks.find((c) => c.type === ChunkType.SKILL_COMPLETE) as any
    expect(completeChunk.skillId).toBe('skill-c')
    expect(completeChunk.finalTokenCount).toBe(42)
  })

  it('continues with remaining skills when one fails', async () => {
    const skills = [makeSkillDescriptor('fail-skill', 'content-fail'), makeSkillDescriptor('ok-skill', 'content-ok')]
    mockGetAll.mockReturnValue(skills)
    mockSelect.mockResolvedValue([
      makeSelectorResult('fail-skill', 'content-fail'),
      makeSelectorResult('ok-skill', 'content-ok')
    ])
    mockPrepare.mockRejectedValueOnce(new Error('context manager exploded')).mockResolvedValueOnce({
      content: 'content-ok',
      tokenCount: 5,
      method: ContextManagementMethod.FULL_INJECTION,
      truncated: false
    })

    const chunks: Chunk[] = []
    // Should not throw
    await expect(
      emitSkillChunks({ prompt: 'test', config: makeConfig(), processChunk: (c) => chunks.push(c) })
    ).resolves.toBeUndefined()

    // No chunks for the failed skill
    const activatedChunks = chunks.filter((c) => c.type === ChunkType.SKILL_ACTIVATED) as any[]
    expect(activatedChunks).toHaveLength(1)
    expect(activatedChunks[0].skillId).toBe('ok-skill')

    // COMPLETE emitted for the successful skill
    const completeChunks = chunks.filter((c) => c.type === ChunkType.SKILL_COMPLETE) as any[]
    expect(completeChunks).toHaveLength(1)
    expect(completeChunks[0].skillId).toBe('ok-skill')
  })

  it('processes multiple matched skills sequentially', async () => {
    const skills = [makeSkillDescriptor('s1', 'content1'), makeSkillDescriptor('s2', 'content2')]
    mockGetAll.mockReturnValue(skills)
    mockSelect.mockResolvedValue([makeSelectorResult('s1', 'content1'), makeSelectorResult('s2', 'content2')])
    mockPrepare
      .mockResolvedValueOnce({
        content: 'content1',
        tokenCount: 2,
        method: ContextManagementMethod.FULL_INJECTION,
        truncated: false
      })
      .mockResolvedValueOnce({
        content: 'content2',
        tokenCount: 2,
        method: ContextManagementMethod.FULL_INJECTION,
        truncated: false
      })

    const chunks: Chunk[] = []
    await emitSkillChunks({
      prompt: 'test',
      config: makeConfig(),
      processChunk: (c) => chunks.push(c)
    })

    const activatedChunks = chunks.filter((c) => c.type === ChunkType.SKILL_ACTIVATED) as any[]
    const completeChunks = chunks.filter((c) => c.type === ChunkType.SKILL_COMPLETE) as any[]

    expect(activatedChunks).toHaveLength(2)
    expect(completeChunks).toHaveLength(2)
    expect(activatedChunks[0].skillId).toBe('s1')
    expect(activatedChunks[1].skillId).toBe('s2')
  })
})
