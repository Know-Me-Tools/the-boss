import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { SettingsContainer, SettingsItem, SettingsTitle } from '@renderer/pages/settings/AgentSettings/shared'
import { useAppSelector } from '@renderer/store'
import type { Assistant, AssistantSettings, InstalledSkill } from '@renderer/types'
import { DEFAULT_SKILL_CONFIG, resolveSkillConfig } from '@renderer/types/skillConfig'
import type { CardProps } from 'antd'
import { Card, Empty, Spin, Switch, Tag } from 'antd'
import { Puzzle } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  buildAssistantSkillOverride,
  isSkillSelectableWithinBaseConfig
} from '../../../services/skills/scopedSkillSelection'

interface Props {
  assistant: Assistant
  updateAssistantSettings: (settings: Partial<AssistantSettings>) => void
}

const cardStyles: CardProps['styles'] = {
  header: {
    paddingLeft: '12px',
    paddingRight: '12px',
    borderBottom: 'none'
  },
  body: {
    paddingLeft: '12px',
    paddingRight: '12px',
    paddingTop: '0px',
    paddingBottom: '12px'
  }
}

const searchBarStyle = { borderRadius: 20 }
const emptyIconStyle = { opacity: 0.3 }

const AssistantSkillCard = memo<{
  disabledReason?: string
  isSelected: boolean
  skill: InstalledSkill
  toggling: boolean
  onToggle: (skill: InstalledSkill) => void
}>(({ disabledReason, isSelected, skill, toggling, onToggle }) => {
  const { t } = useTranslation()
  const handleChange = useCallback(() => {
    if (!disabledReason) {
      onToggle(skill)
    }
  }, [disabledReason, onToggle, skill])

  return (
    <Card
      className="border border-default-200"
      title={
        <div className="flex items-start justify-between gap-3 py-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-medium text-sm">{skill.name}</span>
            {skill.description ? (
              <span className="line-clamp-2 whitespace-normal text-foreground-500 text-xs">{skill.description}</span>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {skill.author && <Tag>{skill.author}</Tag>}
              <Tag color={skill.source === 'builtin' ? 'green' : 'blue'}>
                {skill.source === 'builtin' ? t('agent.settings.skills.builtin', 'Built-in') : skill.source}
              </Tag>
            </div>
          </div>
          <Switch
            checked={isSelected}
            disabled={!!disabledReason}
            loading={toggling}
            onChange={handleChange}
            size="small"
          />
        </div>
      }
      styles={cardStyles}>
      {disabledReason ? <span className="text-foreground-500 text-xs">{disabledReason}</span> : null}
    </Card>
  )
})
AssistantSkillCard.displayName = 'AssistantSkillCard'

const AssistantSkillsSettings: FC<Props> = ({ assistant, updateAssistantSettings }) => {
  const { t } = useTranslation()
  const { skills, loading, error } = useInstalledSkills()
  const globalSkillConfig = useAppSelector((state) => state.skillConfig?.global || DEFAULT_SKILL_CONFIG)
  const [filter, setFilter] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const effectiveSkillConfig = useMemo(
    () => resolveSkillConfig(globalSkillConfig, assistant.settings?.skillConfig),
    [assistant.settings?.skillConfig, globalSkillConfig]
  )

  const selectableSkills = useMemo(
    () => skills.filter((skill) => skill.isEnabled && isSkillSelectableWithinBaseConfig(globalSkillConfig, skill.id)),
    [globalSkillConfig, skills]
  )

  const selectableSkillIds = useMemo(() => selectableSkills.map((skill) => skill.id), [selectableSkills])
  const effectiveSelectedSkillIds = useMemo(
    () => effectiveSkillConfig.selectedSkillIds ?? selectableSkillIds,
    [effectiveSkillConfig.selectedSkillIds, selectableSkillIds]
  )

  const filteredSkills = useMemo(() => {
    if (!filter.trim()) return skills
    const q = filter.toLowerCase()
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(q) ||
        skill.description?.toLowerCase().includes(q) ||
        skill.author?.toLowerCase().includes(q)
    )
  }, [filter, skills])

  const getDisabledReason = useCallback(
    (skill: InstalledSkill) => {
      if (!skill.isEnabled) {
        return t('assistant.settings.skills.disabledGlobally', {
          defaultValue: 'Disabled globally in Settings > Skills'
        })
      }

      if (!isSkillSelectableWithinBaseConfig(globalSkillConfig, skill.id)) {
        return t('assistant.settings.skills.excludedByGlobalDefaults', {
          defaultValue: 'Excluded by global skill defaults'
        })
      }

      return undefined
    },
    [globalSkillConfig, t]
  )

  const handleToggle = useCallback(
    (skill: InstalledSkill) => {
      setTogglingId(skill.id)
      try {
        const nextOverride = buildAssistantSkillOverride({
          baseSkillConfig: globalSkillConfig,
          effectiveSkillConfig,
          selectableSkillIds,
          skillId: skill.id
        })

        updateAssistantSettings({ skillConfig: nextOverride })
      } finally {
        setTogglingId(null)
      }
    },
    [effectiveSkillConfig, globalSkillConfig, selectableSkillIds, updateAssistantSettings]
  )

  const hasNoResults = filteredSkills.length === 0

  return (
    <SettingsContainer>
      <SettingsItem divider={false}>
        <SettingsTitle
          contentAfter={
            <CollapsibleSearchBar
              onSearch={setFilter}
              placeholder={t('agent.settings.skills.searchPlaceholder', 'Search skills...')}
              tooltip={t('agent.settings.skills.searchPlaceholder', 'Search skills...')}
              style={searchBarStyle}
            />
          }>
          {t('agent.settings.skills.title', 'Installed Skills')}
        </SettingsTitle>
        <div className="mt-2 flex flex-col gap-3">
          {error ? (
            <div className="rounded-medium border border-default-200 border-dashed px-4 py-10 text-center text-red-500 text-sm">
              {error}
            </div>
          ) : loading ? (
            <div className="flex flex-1 items-center justify-center py-10">
              <Spin />
            </div>
          ) : hasNoResults ? (
            <div className="flex flex-1 items-center justify-center py-10">
              <Empty
                image={<Puzzle size={40} strokeWidth={1} style={emptyIconStyle} />}
                description={
                  filter
                    ? t('agent.settings.skills.noFilterResults', 'No matching skills')
                    : t('agent.settings.skills.noSkills', 'No skills installed. Install skills from Settings > Skills.')
                }
              />
            </div>
          ) : (
            filteredSkills.map((skill) => (
              <AssistantSkillCard
                key={skill.id}
                skill={skill}
                isSelected={!getDisabledReason(skill) && effectiveSelectedSkillIds.includes(skill.id)}
                disabledReason={getDisabledReason(skill)}
                toggling={togglingId === skill.id}
                onToggle={handleToggle}
              />
            ))
          )}
        </div>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default AssistantSkillsSettings
