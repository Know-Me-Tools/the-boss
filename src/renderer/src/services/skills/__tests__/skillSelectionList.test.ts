import type { InstalledSkill } from '@types'
import { describe, expect, it } from 'vitest'

import {
  buildSkillSearchRecords,
  filterSkillSearchRecords,
  getSkillProviderGroup,
  groupSkillRecords,
  toggleSkillGroup,
  toggleSkillId
} from '../skillSelectionList'

const makeSkill = (overrides: Partial<InstalledSkill> & Pick<InstalledSkill, 'id' | 'name'>): InstalledSkill => ({
  id: overrides.id,
  name: overrides.name,
  description: overrides.description ?? `${overrides.name} description`,
  folderName: overrides.folderName ?? overrides.id,
  source: overrides.source ?? 'local',
  sourceUrl: overrides.sourceUrl ?? null,
  namespace: overrides.namespace ?? null,
  author: overrides.author ?? null,
  tags: overrides.tags ?? [],
  contentHash: overrides.contentHash ?? `${overrides.id}-hash`,
  isEnabled: overrides.isEnabled ?? true,
  createdAt: overrides.createdAt ?? 1,
  updatedAt: overrides.updatedAt ?? 1
})

describe('skillSelectionList', () => {
  it('groups skills by namespace before source URL or source type', () => {
    expect(
      getSkillProviderGroup(
        makeSkill({
          id: 'skill-a',
          name: 'Skill A',
          namespace: 'owner/repo/path',
          sourceUrl: 'https://github.com/fallback/repo'
        })
      )
    ).toMatchObject({
      id: 'namespace:owner/repo',
      label: 'owner/repo'
    })
  })

  it('falls back to repository source URL for provider grouping', () => {
    expect(
      getSkillProviderGroup(
        makeSkill({
          id: 'skill-a',
          name: 'Skill A',
          sourceUrl: 'https://github.com/acme/skills/tree/main/foo'
        })
      )
    ).toMatchObject({
      id: 'url:github.com/acme/skills',
      label: 'github.com/acme/skills'
    })
  })

  it('searches across metadata tokens', () => {
    const records = buildSkillSearchRecords([
      makeSkill({
        id: 'flutter-routing',
        name: 'Navigation',
        description: 'Routes and deep links',
        tags: ['flutter'],
        author: 'Mobile Team'
      }),
      makeSkill({
        id: 'react-cache',
        name: 'React Cache',
        tags: ['frontend']
      })
    ])

    expect(filterSkillSearchRecords(records, 'mobile flutter').map((record) => record.skill.id)).toEqual([
      'flutter-routing'
    ])
  })

  it('returns grouped selected and selectable counts', () => {
    const records = buildSkillSearchRecords([
      makeSkill({ id: 'skill-a', name: 'Skill A', namespace: 'owner/repo/a' }),
      makeSkill({ id: 'skill-b', name: 'Skill B', namespace: 'owner/repo/b', isEnabled: false })
    ])

    const groups = groupSkillRecords(records, ['skill-a'], ['skill-a'])

    expect(groups[0]).toMatchObject({
      selectedCount: 1,
      selectableCount: 1,
      totalCount: 2
    })
  })

  it('toggles individual skills while preserving selectable order', () => {
    expect(toggleSkillId(['skill-c'], ['skill-a', 'skill-b', 'skill-c'], 'skill-a')).toEqual(['skill-a', 'skill-c'])
    expect(toggleSkillId(['skill-a', 'skill-c'], ['skill-a', 'skill-b', 'skill-c'], 'skill-a')).toEqual(['skill-c'])
  })

  it('toggles provider groups while preserving selectable order', () => {
    expect(toggleSkillGroup(['skill-c'], ['skill-a', 'skill-b', 'skill-c'], ['skill-b', 'skill-a'], true)).toEqual([
      'skill-a',
      'skill-b',
      'skill-c'
    ])
    expect(
      toggleSkillGroup(['skill-a', 'skill-b', 'skill-c'], ['skill-a', 'skill-b', 'skill-c'], ['skill-b'], false)
    ).toEqual(['skill-a', 'skill-c'])
  })
})
