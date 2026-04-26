import type { InstalledSkill } from '@types'

export type SkillProviderKind = 'builtin' | 'marketplace' | 'local' | 'zip' | 'source'

export interface SkillProviderGroup {
  id: string
  label: string
  description: string
  kind: SkillProviderKind
}

export interface GroupedSkillSelection {
  group: SkillProviderGroup
  skills: InstalledSkill[]
  selectedCount: number
  selectableCount: number
  totalCount: number
}

export interface SkillSearchRecord {
  skill: InstalledSkill
  group: SkillProviderGroup
  searchText: string
}

export function getSkillProviderGroup(skill: InstalledSkill): SkillProviderGroup {
  const namespaceGroup = getNamespaceGroup(skill.namespace)
  if (namespaceGroup) {
    return namespaceGroup
  }

  const sourceUrlGroup = getSourceUrlGroup(skill.sourceUrl)
  if (sourceUrlGroup) {
    return sourceUrlGroup
  }

  return getSourceGroup(skill.source)
}

export function getSkillSearchText(skill: InstalledSkill, group = getSkillProviderGroup(skill)): string {
  return [
    skill.name,
    skill.description,
    skill.folderName,
    skill.source,
    skill.sourceUrl,
    skill.namespace,
    skill.author,
    group.label,
    group.description,
    ...skill.tags
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function buildSkillSearchRecords(skills: InstalledSkill[]): SkillSearchRecord[] {
  return skills.map((skill) => {
    const group = getSkillProviderGroup(skill)

    return {
      skill,
      group,
      searchText: getSkillSearchText(skill, group)
    }
  })
}

export function filterSkillSearchRecords(records: SkillSearchRecord[], query: string): SkillSearchRecord[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)

  if (tokens.length === 0) {
    return records
  }

  return records.filter((record) => tokens.every((token) => record.searchText.includes(token)))
}

export function groupSkillRecords(
  records: SkillSearchRecord[],
  selectedSkillIds: Iterable<string>,
  selectableSkillIds: Iterable<string>
): GroupedSkillSelection[] {
  const selectedSet = new Set(selectedSkillIds)
  const selectableSet = new Set(selectableSkillIds)
  const groups = new Map<string, GroupedSkillSelection>()

  for (const record of records) {
    const group = groups.get(record.group.id) ?? {
      group: record.group,
      skills: [],
      selectedCount: 0,
      selectableCount: 0,
      totalCount: 0
    }

    group.skills.push(record.skill)
    group.totalCount += 1

    if (selectableSet.has(record.skill.id)) {
      group.selectableCount += 1
    }

    if (selectedSet.has(record.skill.id)) {
      group.selectedCount += 1
    }

    groups.set(record.group.id, group)
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.group.kind !== b.group.kind) {
      return getProviderKindWeight(a.group.kind) - getProviderKindWeight(b.group.kind)
    }

    return a.group.label.localeCompare(b.group.label)
  })
}

export function toggleSkillId(
  selectedSkillIds: string[],
  orderedSelectableSkillIds: string[],
  skillId: string
): string[] {
  const selectedSet = new Set(selectedSkillIds)

  if (selectedSet.has(skillId)) {
    selectedSet.delete(skillId)
  } else {
    selectedSet.add(skillId)
  }

  return orderedSelectableSkillIds.filter((id) => selectedSet.has(id))
}

export function toggleSkillGroup(
  selectedSkillIds: string[],
  orderedSelectableSkillIds: string[],
  groupSkillIds: string[],
  shouldSelect: boolean
): string[] {
  const selectedSet = new Set(selectedSkillIds)

  for (const skillId of groupSkillIds) {
    if (shouldSelect) {
      selectedSet.add(skillId)
    } else {
      selectedSet.delete(skillId)
    }
  }

  return orderedSelectableSkillIds.filter((id) => selectedSet.has(id))
}

export function getSkillSelectionMode(selectedSkillIds: string[] | undefined): 'all' | 'custom' | 'none' {
  if (selectedSkillIds === undefined) {
    return 'all'
  }

  return selectedSkillIds.length === 0 ? 'none' : 'custom'
}

function getNamespaceGroup(namespace: string | null): SkillProviderGroup | undefined {
  if (!namespace) {
    return undefined
  }

  const parts = namespace.split('/').filter(Boolean)
  if (parts.length < 2) {
    return undefined
  }

  const label = `${parts[0]}/${parts[1]}`

  return {
    id: `namespace:${label}`,
    label,
    description: namespace,
    kind: 'source'
  }
}

function getSourceUrlGroup(sourceUrl: string | null): SkillProviderGroup | undefined {
  if (!sourceUrl) {
    return undefined
  }

  try {
    const url = new URL(sourceUrl)
    const pathParts = url.pathname.split('/').filter(Boolean)
    const repository = pathParts.length >= 2 ? `${pathParts[0]}/${pathParts[1]}` : undefined
    const label = repository ? `${url.hostname}/${repository}` : url.hostname

    return {
      id: `url:${label}`,
      label,
      description: sourceUrl,
      kind: 'source'
    }
  } catch {
    return undefined
  }
}

function getSourceGroup(source: string): SkillProviderGroup {
  const normalizedSource = source.toLowerCase()
  const sourceLabels: Record<string, { label: string; kind: SkillProviderKind }> = {
    builtin: { label: 'Built-in', kind: 'builtin' },
    marketplace: { label: 'Marketplace', kind: 'marketplace' },
    local: { label: 'Local', kind: 'local' },
    zip: { label: 'Imported ZIP', kind: 'zip' }
  }
  const matchedSource = sourceLabels[normalizedSource]

  if (matchedSource) {
    return {
      id: `source:${normalizedSource}`,
      label: matchedSource.label,
      description: source,
      kind: matchedSource.kind
    }
  }

  return {
    id: `source:${normalizedSource}`,
    label: toTitleCase(source),
    description: source,
    kind: 'source'
  }
}

function toTitleCase(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
}

function getProviderKindWeight(kind: SkillProviderKind): number {
  switch (kind) {
    case 'builtin':
      return 0
    case 'marketplace':
      return 1
    case 'source':
      return 2
    case 'local':
      return 3
    case 'zip':
      return 4
  }
}
