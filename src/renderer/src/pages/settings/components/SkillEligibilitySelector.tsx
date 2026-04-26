import {
  buildSkillSearchRecords,
  filterSkillSearchRecords,
  getSkillSelectionMode,
  groupSkillRecords,
  toggleSkillGroup,
  toggleSkillId
} from '@renderer/services/skills/skillSelectionList'
import type { InstalledSkill } from '@types'
import { Badge, Button, Checkbox, Empty, Input, Segmented, Tag, Tooltip } from 'antd'
import { Layers3, Search, ShieldCheck } from 'lucide-react'
import type { FC } from 'react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type SelectionMode = 'all' | 'custom' | 'none'

interface SkillEligibilitySelectorProps {
  skills: InstalledSkill[]
  selectedSkillIds?: string[]
  disabled?: boolean
  onSelectedSkillIdsChange: (selectedSkillIds: string[] | undefined) => void
}

const SkillEligibilitySelector: FC<SkillEligibilitySelectorProps> = ({
  skills,
  selectedSkillIds,
  disabled = false,
  onSelectedSkillIdsChange
}) => {
  const { t } = useTranslation()
  const propMode = getSkillSelectionMode(selectedSkillIds)
  const [draftMode, setDraftMode] = useState<SelectionMode>(propMode)
  const [draftSelectedSkillIds, setDraftSelectedSkillIds] = useState<string[] | undefined>(selectedSkillIds)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const emittedSelectedKeyRef = useRef<string | undefined>(undefined)
  const draftModeRef = useRef<SelectionMode>(propMode)
  const selectedSkillIdsKey = getSelectedSkillIdsKey(selectedSkillIds)
  const selectableSkillIds = useMemo(() => skills.filter((skill) => skill.isEnabled).map((skill) => skill.id), [skills])
  const selectableSkillIdSet = useMemo(() => new Set(selectableSkillIds), [selectableSkillIds])
  const selectedSkillIdSet = useMemo(() => {
    if (draftMode === 'all') {
      return selectableSkillIdSet
    }

    if (draftMode === 'none') {
      return new Set<string>()
    }

    return new Set((draftSelectedSkillIds ?? []).filter((skillId) => selectableSkillIdSet.has(skillId)))
  }, [draftMode, draftSelectedSkillIds, selectableSkillIdSet])

  const records = useMemo(() => buildSkillSearchRecords(skills), [skills])
  const filteredRecords = useMemo(() => filterSkillSearchRecords(records, deferredQuery), [deferredQuery, records])
  const groupedSkills = useMemo(
    () => groupSkillRecords(filteredRecords, selectedSkillIdSet, selectableSkillIdSet),
    [filteredRecords, selectableSkillIdSet, selectedSkillIdSet]
  )

  const selectedCount = selectedSkillIdSet.size
  const enabledCount = selectableSkillIds.length
  const disabledCount = Math.max(skills.length - enabledCount, 0)

  useEffect(() => {
    draftModeRef.current = draftMode
  }, [draftMode])

  useEffect(() => {
    if (
      selectedSkillIdsKey === emittedSelectedKeyRef.current &&
      draftModeRef.current === 'custom' &&
      selectedSkillIds?.length === 0
    ) {
      return
    }

    setDraftMode(propMode)
    setDraftSelectedSkillIds(selectedSkillIds)
  }, [propMode, selectedSkillIds, selectedSkillIdsKey])

  const applySelection = (nextMode: SelectionMode, nextSelectedSkillIds: string[] | undefined) => {
    emittedSelectedKeyRef.current = getSelectedSkillIdsKey(nextSelectedSkillIds)
    setDraftMode(nextMode)
    setDraftSelectedSkillIds(nextSelectedSkillIds)
    onSelectedSkillIdsChange(nextSelectedSkillIds)
  }

  const handleModeChange = (nextMode: SelectionMode) => {
    if (nextMode === 'all') {
      applySelection('all', undefined)
      return
    }

    if (nextMode === 'none') {
      applySelection('none', [])
      return
    }

    applySelection('custom', draftMode === 'all' ? selectableSkillIds : (draftSelectedSkillIds ?? []))
  }

  const handleSkillToggle = (skillId: string) => {
    if (!selectableSkillIdSet.has(skillId)) {
      return
    }

    const nextSkillIds = toggleSkillId(draftSelectedSkillIds ?? selectableSkillIds, selectableSkillIds, skillId)
    applySelection('custom', nextSkillIds)
  }

  const handleGroupToggle = (groupSkillIds: string[], shouldSelect: boolean) => {
    const nextSkillIds = toggleSkillGroup(
      draftSelectedSkillIds ?? selectableSkillIds,
      selectableSkillIds,
      groupSkillIds,
      shouldSelect
    )
    applySelection('custom', nextSkillIds)
  }

  return (
    <SelectorSection aria-label={t('settings.skill.selectedSkills.scopeLabel', { defaultValue: 'Eligible Skills' })}>
      <SelectorHeader>
        <SelectorHeading>
          <SelectorTitle>
            {t('settings.skill.selectedSkills.scopeLabel', {
              defaultValue: 'Eligible Skills'
            })}
          </SelectorTitle>
          <SelectorDescription>
            {t('settings.skill.selectedSkills.description', {
              defaultValue: 'Choose which installed skills can be considered for activation in this scope.'
            })}
          </SelectorDescription>
        </SelectorHeading>
        <Segmented
          value={draftMode}
          disabled={disabled}
          options={[
            {
              value: 'all',
              label: t('settings.skill.selectedSkills.all', {
                defaultValue: 'All enabled'
              })
            },
            {
              value: 'custom',
              label: t('settings.skill.selectedSkills.custom', {
                defaultValue: 'Selected only'
              })
            },
            {
              value: 'none',
              label: t('settings.skill.selectedSkills.none', {
                defaultValue: 'Disable all'
              })
            }
          ]}
          onChange={(value) => handleModeChange(value as SelectionMode)}
        />
      </SelectorHeader>

      <SelectorStats aria-live="polite">
        <StatPill>
          {t('settings.skill.selectedSkills.selectedCount', {
            defaultValue: '{{selected}} selected',
            selected: selectedCount
          })}
        </StatPill>
        <StatPill>
          {t('settings.skill.selectedSkills.enabledCount', {
            defaultValue: '{{enabled}} enabled',
            enabled: enabledCount
          })}
        </StatPill>
        {disabledCount > 0 && (
          <StatPill>
            {t('settings.skill.selectedSkills.unavailableCount', {
              defaultValue: '{{count}} unavailable',
              count: disabledCount
            })}
          </StatPill>
        )}
      </SelectorStats>

      {draftMode === 'custom' && (
        <SelectorBody>
          <Toolbar>
            <Input
              allowClear
              value={query}
              disabled={disabled}
              prefix={<Search size={15} aria-hidden />}
              placeholder={t('settings.skill.selectedSkills.searchPlaceholder', {
                defaultValue: 'Search name, description, tag, source, or author'
              })}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              disabled={disabled || selectedCount === 0}
              onClick={() => applySelection('custom', [])}
              aria-label={t('settings.skill.selectedSkills.clearSelection', {
                defaultValue: 'Clear selected skills'
              })}>
              {t('settings.skill.selectedSkills.clear', {
                defaultValue: 'Clear'
              })}
            </Button>
          </Toolbar>

          <TableHeader aria-hidden>
            <span />
            <span>{t('settings.skill.selectedSkills.columns.skill', { defaultValue: 'Skill' })}</span>
            <span>{t('settings.skill.selectedSkills.columns.provider', { defaultValue: 'Provider' })}</span>
            <span>{t('settings.skill.selectedSkills.columns.location', { defaultValue: 'Location' })}</span>
            <span>{t('settings.skill.selectedSkills.columns.author', { defaultValue: 'Author' })}</span>
            <span>{t('settings.skill.selectedSkills.columns.tags', { defaultValue: 'Tags' })}</span>
            <span>{t('settings.skill.selectedSkills.columns.status', { defaultValue: 'Status' })}</span>
          </TableHeader>

          <SkillRows role="list">
            {groupedSkills.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('settings.skill.selectedSkills.noResults', {
                  defaultValue: 'No matching skills'
                })}
              />
            ) : (
              groupedSkills.map((group) => {
                const groupSelectableSkillIds = group.skills
                  .filter((skill) => selectableSkillIdSet.has(skill.id))
                  .map((skill) => skill.id)
                const groupChecked = group.selectableCount > 0 && group.selectedCount === group.selectableCount
                const groupIndeterminate = group.selectedCount > 0 && group.selectedCount < group.selectableCount

                return (
                  <GroupBlock key={group.group.id}>
                    <GroupHeader>
                      <Checkbox
                        checked={groupChecked}
                        indeterminate={groupIndeterminate}
                        disabled={disabled || group.selectableCount === 0}
                        aria-label={t('settings.skill.selectedSkills.toggleGroup', {
                          defaultValue: 'Toggle {{provider}} skills',
                          provider: group.group.label
                        })}
                        onChange={(event) => handleGroupToggle(groupSelectableSkillIds, event.target.checked)}
                      />
                      <GroupTitle>
                        <Layers3 size={14} aria-hidden />
                        <span>{group.group.label}</span>
                      </GroupTitle>
                      <GroupMeta>
                        {t('settings.skill.selectedSkills.groupCount', {
                          defaultValue: '{{selected}}/{{total}} selected',
                          selected: group.selectedCount,
                          total: group.selectableCount
                        })}
                      </GroupMeta>
                    </GroupHeader>

                    {group.skills.map((skill) => {
                      const rowDisabled = disabled || !selectableSkillIdSet.has(skill.id)
                      const checked = selectedSkillIdSet.has(skill.id)
                      const location = skill.namespace || skill.folderName
                      const tags = skill.tags.slice(0, 3)

                      return (
                        <SkillRow key={skill.id} role="listitem" $disabled={rowDisabled}>
                          <Checkbox
                            checked={checked}
                            disabled={rowDisabled}
                            aria-label={t('settings.skill.selectedSkills.toggleSkill', {
                              defaultValue: 'Toggle {{skill}}',
                              skill: skill.name
                            })}
                            onChange={() => handleSkillToggle(skill.id)}
                          />
                          <SkillNameCell>
                            <Tooltip title={skill.name}>
                              <SkillName>{skill.name}</SkillName>
                            </Tooltip>
                            <Tooltip title={skill.description || undefined}>
                              <SkillDescription>{skill.description || skill.folderName}</SkillDescription>
                            </Tooltip>
                          </SkillNameCell>
                          <ProviderCell>
                            <ProviderBadge>{group.group.label}</ProviderBadge>
                          </ProviderCell>
                          <Tooltip title={location}>
                            <MetadataCell>{location}</MetadataCell>
                          </Tooltip>
                          <Tooltip title={skill.author || undefined}>
                            <MetadataCell>{skill.author || '-'}</MetadataCell>
                          </Tooltip>
                          <TagCell>
                            {tags.length > 0 ? tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <MutedText>-</MutedText>}
                          </TagCell>
                          <StatusCell>
                            {skill.isEnabled ? (
                              <Badge
                                status="success"
                                text={t('settings.skill.selectedSkills.available', {
                                  defaultValue: 'Available'
                                })}
                              />
                            ) : (
                              <Tooltip
                                title={t('settings.skill.selectedSkills.unavailableDescription', {
                                  defaultValue: 'Enable this skill before it can be selected here.'
                                })}>
                                <UnavailableStatus>
                                  <ShieldCheck size={13} aria-hidden />
                                  {t('settings.skill.selectedSkills.unavailable', {
                                    defaultValue: 'Unavailable'
                                  })}
                                </UnavailableStatus>
                              </Tooltip>
                            )}
                          </StatusCell>
                        </SkillRow>
                      )
                    })}
                  </GroupBlock>
                )
              })
            )}
          </SkillRows>
        </SelectorBody>
      )}
    </SelectorSection>
  )
}

function getSelectedSkillIdsKey(skillIds: string[] | undefined): string {
  return skillIds === undefined ? '__all__' : skillIds.join('\u0000')
}

const SelectorSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
`

const SelectorHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;

  @media (max-width: 900px) {
    flex-direction: column;
  }
`

const SelectorHeading = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`

const SelectorTitle = styled.div`
  color: var(--color-text-1);
  font-size: 14px;
  font-weight: 600;
  line-height: 18px;
`

const SelectorDescription = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
  line-height: 18px;
`

const SelectorStats = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const StatPill = styled.span`
  border: 0.5px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text-2);
  font-size: 12px;
  line-height: 20px;
  padding: 0 8px;
  background: var(--color-background-soft);
`

const SelectorBody = styled.div`
  border: 0.5px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-background);
`

const Toolbar = styled.div`
  display: grid;
  grid-template-columns: minmax(240px, 1fr) auto;
  gap: 8px;
  padding: 10px;
  border-bottom: 0.5px solid var(--color-border);
  background: var(--color-background-soft);
`

const TableHeader = styled.div`
  display: grid;
  grid-template-columns: 32px minmax(220px, 2fr) minmax(130px, 1fr) minmax(130px, 1fr) minmax(96px, 0.8fr) minmax(
      120px,
      1fr
    ) 96px;
  gap: 10px;
  align-items: center;
  padding: 8px 12px;
  color: var(--color-text-3);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  text-transform: uppercase;
  border-bottom: 0.5px solid var(--color-border);
`

const SkillRows = styled.div`
  max-height: 440px;
  overflow: auto;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 8px;
  }
`

const GroupBlock = styled.div`
  border-bottom: 0.5px solid var(--color-border);

  &:last-child {
    border-bottom: 0;
  }
`

const GroupHeader = styled.div`
  position: sticky;
  top: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 36px;
  padding: 0 12px;
  background: color-mix(in srgb, var(--color-background-soft) 88%, var(--color-background));
  border-bottom: 0.5px solid var(--color-border);
`

const GroupTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--color-text-1);
  font-size: 13px;
  font-weight: 600;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const GroupMeta = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
`

const SkillRow = styled.div<{ $disabled: boolean }>`
  display: grid;
  grid-template-columns: 32px minmax(220px, 2fr) minmax(130px, 1fr) minmax(130px, 1fr) minmax(96px, 0.8fr) minmax(
      120px,
      1fr
    ) 96px;
  gap: 10px;
  align-items: center;
  min-height: 58px;
  padding: 8px 12px;
  opacity: ${({ $disabled }) => ($disabled ? 0.58 : 1)};

  &:not(:last-child) {
    border-bottom: 0.5px solid color-mix(in srgb, var(--color-border) 70%, transparent);
  }

  &:focus-within,
  &:hover {
    background: var(--color-background-soft);
  }
`

const SkillNameCell = styled.div`
  min-width: 0;
`

const SkillName = styled.div`
  overflow: hidden;
  color: var(--color-text-1);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const SkillDescription = styled.div`
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-text-3);
  font-size: 12px;
  line-height: 16px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
`

const ProviderCell = styled.div`
  min-width: 0;
`

const ProviderBadge = styled.span`
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  border: 0.5px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text-2);
  font-size: 12px;
  line-height: 22px;
  padding: 0 7px;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--color-background-soft);
`

const MetadataCell = styled.div`
  overflow: hidden;
  min-width: 0;
  color: var(--color-text-2);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const TagCell = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 4px;

  .ant-tag {
    max-width: 100%;
    margin-inline-end: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const StatusCell = styled.div`
  min-width: 0;
  color: var(--color-text-2);
  font-size: 12px;

  .ant-badge-status-text {
    margin-inline-start: 5px;
    color: var(--color-text-2);
    font-size: 12px;
  }
`

const UnavailableStatus = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text-3);
`

const MutedText = styled.span`
  color: var(--color-text-3);
  font-size: 12px;
`

export default SkillEligibilitySelector
