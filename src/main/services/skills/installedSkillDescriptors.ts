import { loggerService } from '@logger'
import { SkillService } from '@main/services/agents/skills/SkillService'
import type { InstalledSkill, SkillGlobalConfig } from '@types'
import { escapeRegExp } from 'lodash'

import { type SkillDescriptor,SkillRegistry } from './skillRegistry'

const logger = loggerService.withContext('MainInstalledSkillDescriptors')
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

  const skillService = SkillService.getInstance()
  const selectedSkillSet = config.selectedSkillIds ? new Set(config.selectedSkillIds) : undefined
  const installedSkills = (await skillService.list()).filter(
    (skill) => skill.isEnabled && (selectedSkillSet === undefined || selectedSkillSet.has(skill.id))
  )

  const descriptors = (await Promise.all(installedSkills.map((skill) => loadInstalledSkillDescriptor(skillService, skill)))).filter(
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

async function loadInstalledSkillDescriptor(
  skillService: SkillService,
  skill: InstalledSkill
): Promise<SkillDescriptor | null> {
  const cacheKey = `${skill.id}:${skill.contentHash}`
  const cached = contentCache.get(cacheKey)
  const content = cached ?? (await skillService.readFile(skill.id, 'SKILL.md'))

  if (!content?.trim()) {
    logger.warn('Skipping installed skill without readable SKILL.md content', { skillId: skill.id })
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
