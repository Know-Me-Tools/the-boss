import type { InstalledSkill, SkillConfigOverride, SkillScopeRef } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GLOBAL_SKILL_SCOPE, SkillScopeService } from '../SkillScopeService'

const { mockSkillRepository, mockSkillScopeRepository } = vi.hoisted(() => ({
  mockSkillRepository: {
    list: vi.fn()
  },
  mockSkillScopeRepository: {
    get: vi.fn(),
    upsert: vi.fn()
  }
}))

vi.mock('../SkillRepository', () => ({
  SkillRepository: {
    getInstance: () => mockSkillRepository
  }
}))

vi.mock('../SkillScopeRepository', () => ({
  SkillScopeRepository: {
    getInstance: () => mockSkillScopeRepository
  }
}))

function createSkill(id: string, folderName: string): InstalledSkill {
  return {
    id,
    name: folderName,
    description: null,
    folderName,
    source: 'builtin',
    sourceUrl: `git@github.com:Prometheus-AGS/prometheus-skill-system.git#${folderName}`,
    namespace: null,
    author: null,
    tags: [],
    contentHash: 'hash',
    isEnabled: false,
    createdAt: 1,
    updatedAt: 1
  }
}

function scopeKey(scope: SkillScopeRef): string {
  return `${scope.type}:${scope.id}`
}

function installScopeRows(rows: Array<{ scope: SkillScopeRef; config: SkillConfigOverride | null }>) {
  const rowsByScope = new Map(rows.map((row) => [scopeKey(row.scope), row.config]))
  mockSkillScopeRepository.get.mockImplementation(async (scope: SkillScopeRef) => {
    if (!rowsByScope.has(scopeKey(scope))) {
      return null
    }

    return {
      scopeType: scope.type,
      scopeId: scope.id,
      config: rowsByScope.get(scopeKey(scope)),
      createdAt: 1,
      updatedAt: 1
    }
  })
}

describe('SkillScopeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists Prometheus built-ins through assistant, agent, and session scopes', async () => {
    const artifactRefiner = createSkill(
      'artifact-refiner',
      'prometheus-skill-system__skills__imported__artifact-refiner'
    )
    const refineValidate = createSkill(
      'refine-validate',
      'prometheus-skill-system__skills__imported__artifact-refiner__skills__refine-validate'
    )
    const kbdPlan = createSkill(
      'kbd-plan',
      'prometheus-skill-system__skills__process__kbd-process-orchestrator__skills__kbd-plan'
    )
    const sycophancyCorrection = createSkill(
      'sycophancy-correction',
      'prometheus-skill-system__skills__imported__sycophancy-correction'
    )

    mockSkillRepository.list.mockResolvedValue([artifactRefiner, refineValidate, kbdPlan, sycophancyCorrection])

    installScopeRows([
      {
        scope: GLOBAL_SKILL_SCOPE,
        config: { selectedSkillIds: [artifactRefiner.id, refineValidate.id, kbdPlan.id, sycophancyCorrection.id] }
      },
      {
        scope: { type: 'assistant', id: 'assistant-1' },
        config: { selectedSkillIds: [artifactRefiner.id, refineValidate.id, kbdPlan.id] }
      },
      {
        scope: { type: 'agent', id: 'agent-1' },
        config: { selectedSkillIds: [artifactRefiner.id, refineValidate.id] }
      },
      {
        scope: { type: 'session', id: 'session-1' },
        config: { selectedSkillIds: [refineValidate.id] }
      }
    ])

    const service = SkillScopeService.getInstance()
    const assistantSkills = await service.listSkillsForScope({ type: 'assistant', id: 'assistant-1' })
    const sessionSkills = await service.listSkillsForScope([
      { type: 'agent', id: 'agent-1' },
      { type: 'session', id: 'session-1' }
    ])

    expect(assistantSkills).toEqual([
      expect.objectContaining({ id: artifactRefiner.id, isEnabled: true }),
      expect.objectContaining({ id: refineValidate.id, isEnabled: true }),
      expect.objectContaining({ id: kbdPlan.id, isEnabled: true }),
      expect.objectContaining({ id: sycophancyCorrection.id, isEnabled: false })
    ])
    expect(sessionSkills).toEqual([
      expect.objectContaining({ id: artifactRefiner.id, isEnabled: false }),
      expect.objectContaining({ id: refineValidate.id, isEnabled: true }),
      expect.objectContaining({ id: kbdPlan.id, isEnabled: false }),
      expect.objectContaining({ id: sycophancyCorrection.id, isEnabled: false })
    ])
  })
})
