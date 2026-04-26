import type { SkillConfigOverride, SkillGlobalConfig } from '@renderer/types/skillConfig'
import { deriveSkillConfigOverride, resolveSkillConfig } from '@renderer/types/skillConfig'
import type { InstalledSkill } from '@types'

export type SkillSelectionMode = 'all' | 'none' | 'custom'

export interface SkillSelectionSummary {
  mode: SkillSelectionMode
  enabledSkillCount: number
  selectedSkillCount: number
  enabledSkills: InstalledSkill[]
  selectedSkills: InstalledSkill[]
}

export function getSkillSelectionSummary(
  config: SkillGlobalConfig,
  installedSkills: InstalledSkill[]
): SkillSelectionSummary {
  const enabledSkills = installedSkills.filter((skill) => skill.isEnabled)
  const skillMap = new Map(enabledSkills.map((skill) => [skill.id, skill]))

  if (config.selectedSkillIds === undefined) {
    return {
      mode: 'all',
      enabledSkillCount: enabledSkills.length,
      selectedSkillCount: enabledSkills.length,
      enabledSkills,
      selectedSkills: enabledSkills
    }
  }

  if (config.selectedSkillIds.length === 0) {
    return {
      mode: 'none',
      enabledSkillCount: enabledSkills.length,
      selectedSkillCount: 0,
      enabledSkills,
      selectedSkills: []
    }
  }

  const selectedSkills = config.selectedSkillIds
    .map((skillId) => skillMap.get(skillId))
    .filter((skill): skill is InstalledSkill => !!skill)

  return {
    mode: 'custom',
    enabledSkillCount: enabledSkills.length,
    selectedSkillCount: selectedSkills.length,
    enabledSkills,
    selectedSkills
  }
}

export function isSkillSelectableWithinBaseConfig(baseSkillConfig: SkillGlobalConfig, skillId: string): boolean {
  return baseSkillConfig.selectedSkillIds === undefined || baseSkillConfig.selectedSkillIds.includes(skillId)
}

export function buildConversationSkillOverride(params: {
  baseSkillConfig: SkillGlobalConfig
  effectiveSkillConfig: SkillGlobalConfig
  skillId: string
}): SkillConfigOverride | undefined {
  const { baseSkillConfig, effectiveSkillConfig, skillId } = params
  const currentSelectedSkillIds = effectiveSkillConfig.selectedSkillIds
  const nextSelectedSkillIds = currentSelectedSkillIds?.includes(skillId)
    ? currentSelectedSkillIds.filter((id) => id !== skillId)
    : [...(currentSelectedSkillIds ?? []), skillId]

  if (nextSelectedSkillIds.length === 0) {
    return deriveSkillConfigOverride(baseSkillConfig, {
      ...effectiveSkillConfig,
      selectedSkillIds: baseSkillConfig.selectedSkillIds
    })
  }

  const nextSkillConfig = resolveSkillConfig(effectiveSkillConfig, {
    selectedSkillIds: nextSelectedSkillIds
  })

  return deriveSkillConfigOverride(baseSkillConfig, nextSkillConfig)
}

export function buildConversationSkillSelectionOverride(params: {
  baseSkillConfig: SkillGlobalConfig
  effectiveSkillConfig: SkillGlobalConfig
  selectableSkillIds: string[]
  selectedSkillIds: string[]
}): SkillConfigOverride | undefined {
  const { baseSkillConfig, effectiveSkillConfig, selectableSkillIds, selectedSkillIds } = params
  const normalizedSelectableSkillIds = Array.from(new Set(selectableSkillIds))
  const orderedSelectedSkillIds = normalizedSelectableSkillIds.filter((id) => selectedSkillIds.includes(id))
  const baseSelectedSkillIds = baseSkillConfig.selectedSkillIds ?? normalizedSelectableSkillIds
  const shouldResetToBase = areStringArraysEqual(orderedSelectedSkillIds, baseSelectedSkillIds)

  const nextSkillConfig = shouldResetToBase
    ? baseSkillConfig
    : resolveSkillConfig(effectiveSkillConfig, {
        selectedSkillIds: orderedSelectedSkillIds
      })

  return deriveSkillConfigOverride(baseSkillConfig, nextSkillConfig)
}

export function buildAssistantSkillOverride(params: {
  baseSkillConfig: SkillGlobalConfig
  effectiveSkillConfig: SkillGlobalConfig
  selectableSkillIds: string[]
  skillId: string
}): SkillConfigOverride | undefined {
  const { baseSkillConfig, effectiveSkillConfig, selectableSkillIds, skillId } = params
  const normalizedSelectableSkillIds = Array.from(new Set(selectableSkillIds))
  const currentSelectedSkillIds = effectiveSkillConfig.selectedSkillIds ?? normalizedSelectableSkillIds

  const nextSelectedSkillIds = currentSelectedSkillIds.includes(skillId)
    ? currentSelectedSkillIds.filter((id) => id !== skillId)
    : [...currentSelectedSkillIds, skillId]

  const orderedSelectedSkillIds = normalizedSelectableSkillIds.filter((id) => nextSelectedSkillIds.includes(id))
  const shouldResetToBase = orderedSelectedSkillIds.length === normalizedSelectableSkillIds.length

  const nextSkillConfig = resolveSkillConfig(effectiveSkillConfig, {
    selectedSkillIds: shouldResetToBase ? baseSkillConfig.selectedSkillIds : orderedSelectedSkillIds
  })

  return deriveSkillConfigOverride(baseSkillConfig, nextSkillConfig)
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}
