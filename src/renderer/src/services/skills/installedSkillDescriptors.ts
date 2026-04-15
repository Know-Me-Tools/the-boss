import { loggerService } from '@logger'
import type { InstalledSkill } from '@renderer/types'
import type { SkillGlobalConfig } from '@renderer/types/skillConfig'
import { escapeRegExp } from 'lodash'

import { type SkillDescriptor,SkillRegistry } from './skillRegistry'

const logger = loggerService.withContext('InstalledSkillDescriptors')
const contentCache = new Map<string, string>()

type LoadedSkillSelectionResources = {
  skills: SkillDescriptor[]
  registry: SkillRegistry
}

export async function loadInstalledSkillSelectionResources(
  config: SkillGlobalConfig
): Promise<LoadedSkillSelectionResources> {
  if (config.selectedSkillIds?.length === 0) {
    return {
      skills: [],
      registry: new SkillRegistry()
    }
  }

  const result = await window.api.skill.list()
  if (!result.success) {
    logger.warn('Failed to load installed skills for selection')
    return {
      skills: [],
      registry: new SkillRegistry()
    }
  }

  const selectedSkillSet = config.selectedSkillIds ? new Set(config.selectedSkillIds) : undefined
  const installedSkills = result.data.filter(
    (skill) => skill.isEnabled && (selectedSkillSet === undefined || selectedSkillSet.has(skill.id))
  )

  const descriptors = (await Promise.all(installedSkills.map(loadInstalledSkillDescriptor))).filter(
    (descriptor): descriptor is SkillDescriptor => descriptor !== null
  )

  const registry = new SkillRegistry()
  for (const descriptor of descriptors) {
    registry.register(descriptor)
  }

  return {
    skills: registry.getAll(),
    registry
  }
}

async function loadInstalledSkillDescriptor(skill: InstalledSkill): Promise<SkillDescriptor | null> {
  const cacheKey = `${skill.id}:${skill.contentHash}`
  const cached = contentCache.get(cacheKey)
  const content = cached ?? (await readSkillContent(skill.id))

  if (!content) {
    return null
  }

  if (!cached) {
    contentCache.set(cacheKey, content)
  }

  return {
    id: skill.id,
    name: skill.name,
    description: buildSelectionDescription(skill, content),
    triggerPatterns: buildTriggerPatterns(skill),
    getContent: () => content,
    priority: 1
  }
}

async function readSkillContent(skillId: string): Promise<string | null> {
  const result = await window.api.skill.readSkillFile(skillId, 'SKILL.md')
  if (!result.success || !result.data?.trim()) {
    return null
  }
  return result.data
}

function buildSelectionDescription(skill: InstalledSkill, content: string): string {
  const summary = extractSkillSummary(content)
  return [skill.name, skill.description, summary, skill.tags.join(' '), skill.folderName, skill.namespace ?? '']
    .filter(Boolean)
    .join('\n')
}

function extractSkillSummary(content: string): string {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('```'))

  return lines.slice(0, 6).join(' ').slice(0, 400)
}

function buildTriggerPatterns(skill: InstalledSkill): RegExp[] {
  const rawTerms = [skill.name, skill.folderName, ...(skill.tags ?? [])]
  const uniqueTerms = Array.from(
    new Set(
      rawTerms
        .flatMap((term) => term.split(/[\s/_-]+/))
        .map((term) => term.trim())
        .filter((term) => term.length >= 3)
    )
  )

  return uniqueTerms.map((term) => new RegExp(escapeRegExp(term), 'i'))
}
