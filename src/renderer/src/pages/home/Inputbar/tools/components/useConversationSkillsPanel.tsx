import { loggerService } from '@logger'
import type { QuickPanelListItem } from '@renderer/components/QuickPanel'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import type { ToolQuickPanelApi, ToolQuickPanelController } from '@renderer/pages/home/Inputbar/types'
import ConversationSettingsPopup from '@renderer/pages/settings/ConversationSettingsPopup'
import {
  buildConversationSkillOverride,
  buildConversationSkillSelectionOverride,
  getSkillSelectionSummary,
  isSkillSelectableWithinBaseConfig
} from '@renderer/services/skills/scopedSkillSelection'
import {
  buildSkillSearchRecords,
  groupSkillRecords,
  toggleSkillGroup
} from '@renderer/services/skills/skillSelectionList'
import { useAppSelector } from '@renderer/store'
import type { Assistant, Topic } from '@renderer/types'
import type { SkillConfigOverride } from '@renderer/types/skillConfig'
import { DEFAULT_SKILL_CONFIG, hasSkillConfigOverride, resolveSkillConfig } from '@renderer/types/skillConfig'
import { Layers3, Settings2, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useConversationSkillsPanel')
const CONVERSATION_SKILLS_SYMBOL = 'conversation-skills'

interface Params {
  quickPanel: ToolQuickPanelApi
  quickPanelController: ToolQuickPanelController
  assistant: Assistant
  topic: Topic
  updateTopic: (topic: Topic) => void
}

export const useConversationSkillsPanel = ({
  quickPanel,
  quickPanelController,
  assistant,
  topic,
  updateTopic
}: Params) => {
  const { registerRootMenu } = quickPanel
  const { open, updateList, isVisible, symbol } = quickPanelController
  const { t } = useTranslation()
  const globalSkillConfig = useAppSelector((state) => state.skillConfig?.global || DEFAULT_SKILL_CONFIG)
  const { skills } = useInstalledSkills()

  // Fetch the DB-backed skill scope config for this assistant. The in-memory
  // assistant.settings?.skillConfig is almost always undefined because skill
  // config is persisted exclusively via window.api.skillScope.setConfig.
  const [assistantScopeConfig, setAssistantScopeConfig] = useState<SkillConfigOverride | undefined>(undefined)
  useEffect(() => {
    window.api.skillScope
      .getConfig({ type: 'assistant', id: assistant.id })
      .then((result) => {
        if (result.success && result.data?.config) {
          setAssistantScopeConfig(result.data.config)
        } else {
          // Fall back to in-memory value so the hook degrades gracefully when
          // the IPC call fails or no DB entry exists yet.
          setAssistantScopeConfig(assistant.settings?.skillConfig)
        }
      })
      .catch(() => {
        setAssistantScopeConfig(assistant.settings?.skillConfig)
      })
  }, [assistant.id, assistant.settings?.skillConfig])

  const baseSkillConfig = useMemo(
    () => resolveSkillConfig(globalSkillConfig, assistantScopeConfig),
    [assistantScopeConfig, globalSkillConfig]
  )
  const effectiveConversationSkillConfig = useMemo(
    () => resolveSkillConfig(baseSkillConfig, topic.skillConfig),
    [baseSkillConfig, topic.skillConfig]
  )
  const enabledSkills = useMemo(() => skills.filter((skill) => skill.isEnabled), [skills])
  const selectableSkillIds = useMemo(
    () =>
      enabledSkills
        .filter((skill) => isSkillSelectableWithinBaseConfig(baseSkillConfig, skill.id))
        .map((skill) => skill.id),
    [baseSkillConfig, enabledSkills]
  )
  const selectionSummary = useMemo(
    () => getSkillSelectionSummary(effectiveConversationSkillConfig, enabledSkills),
    [effectiveConversationSkillConfig, enabledSkills]
  )
  const selectedSkillIds = useMemo(
    () => effectiveConversationSkillConfig.selectedSkillIds ?? selectableSkillIds,
    [effectiveConversationSkillConfig.selectedSkillIds, selectableSkillIds]
  )
  const skillRecords = useMemo(() => buildSkillSearchRecords(enabledSkills), [enabledSkills])
  const groupedSkillRecords = useMemo(
    () => groupSkillRecords(skillRecords, selectedSkillIds, selectableSkillIds),
    [selectableSkillIds, selectedSkillIds, skillRecords]
  )

  const buildItems = useCallback((): QuickPanelListItem[] => {
    const statusDescription = !hasSkillConfigOverride(topic.skillConfig)
      ? t('chat.input.conversation_skills.inherited', {
          defaultValue: 'Using assistant defaults for this conversation'
        })
      : selectionSummary.mode === 'none'
        ? t('chat.input.conversation_skills.none_selected', {
            defaultValue: 'This conversation currently disables all skills'
          })
        : selectionSummary.mode === 'custom'
          ? t('chat.input.conversation_skills.custom_selected', {
              defaultValue: '{{count}} conversation-selected skills are eligible',
              count: selectionSummary.selectedSkillCount
            })
          : t('chat.input.conversation_skills.all_enabled', {
              defaultValue: 'All enabled skills are eligible in this conversation'
            })

    const statusItem: QuickPanelListItem = {
      label: t('chat.input.conversation_skills.title', {
        defaultValue: 'Conversation Skills'
      }),
      description: statusDescription,
      icon: <Zap size={16} />,
      disabled: true,
      alwaysVisible: true,
      action: () => {}
    }

    const manageItem: QuickPanelListItem = {
      label: t('chat.input.conversation_skills.open_settings', {
        defaultValue: 'Open skill settings'
      }),
      description: t('chat.input.conversation_skills.open_settings_description', {
        defaultValue: 'Use the full grouped selector for this conversation'
      }),
      icon: <Settings2 size={16} />,
      alwaysVisible: true,
      action: ({ context }) => {
        context.close('select')
        void ConversationSettingsPopup.show({
          assistantId: assistant.id,
          topicId: topic.id
        })
      }
    }

    const groupItems = groupedSkillRecords.flatMap((group) => {
      const groupSelectableSkillIds = group.skills
        .filter((skill) => isSkillSelectableWithinBaseConfig(baseSkillConfig, skill.id))
        .map((skill) => skill.id)
      const groupChecked = group.selectableCount > 0 && group.selectedCount === group.selectableCount
      const groupIndeterminate = group.selectedCount > 0 && group.selectedCount < group.selectableCount
      const groupItem: QuickPanelListItem = {
        label: group.group.label,
        description: groupIndeterminate
          ? t('chat.input.conversation_skills.group_partial', {
              defaultValue: '{{selected}} of {{total}} selected',
              selected: group.selectedCount,
              total: group.selectableCount
            })
          : groupChecked
            ? t('chat.input.conversation_skills.group_clear', {
                defaultValue: 'Clear all skills from this provider'
              })
            : t('chat.input.conversation_skills.group_select', {
                defaultValue: 'Select all skills from this provider'
              }),
        icon: <Layers3 size={16} />,
        filterText: `${group.group.label} ${group.group.description}`,
        suffix: `${group.selectedCount}/${group.selectableCount}`,
        isSelected: groupChecked,
        disabled: group.selectableCount === 0,
        action: () => {
          const nextSelectedSkillIds = toggleSkillGroup(
            selectedSkillIds,
            selectableSkillIds,
            groupSelectableSkillIds,
            !groupChecked
          )
          const nextOverride = buildConversationSkillSelectionOverride({
            baseSkillConfig,
            effectiveSkillConfig: effectiveConversationSkillConfig,
            selectableSkillIds,
            selectedSkillIds: nextSelectedSkillIds
          })

          updateTopic({
            ...topic,
            skillConfig: nextOverride
          })
        }
      }

      const skillItems = group.skills.map((skill) => {
        const selectable = isSkillSelectableWithinBaseConfig(baseSkillConfig, skill.id)

        return {
          label: skill.name,
          description: selectable
            ? skill.description || ''
            : t('chat.input.conversation_skills.locked_by_assistant', {
                defaultValue: 'Excluded by assistant defaults'
              }),
          icon: <Zap size={16} />,
          filterText: `${skill.name} ${skill.description || ''} ${skill.folderName} ${skill.source} ${
            skill.sourceUrl || ''
          } ${skill.namespace || ''} ${skill.author || ''} ${skill.tags.join(' ')} ${group.group.label}`,
          suffix: group.group.label,
          isSelected: selectedSkillIds.includes(skill.id),
          disabled: !selectable,
          action: () => {
            if (!selectable) {
              return
            }

            const nextOverride = buildConversationSkillOverride({
              baseSkillConfig,
              effectiveSkillConfig: effectiveConversationSkillConfig,
              skillId: skill.id
            })

            updateTopic({
              ...topic,
              skillConfig: nextOverride
            })
          }
        } satisfies QuickPanelListItem
      })

      return [groupItem, ...skillItems]
    })

    return [statusItem, manageItem, ...groupItems]
  }, [
    assistant.id,
    baseSkillConfig,
    effectiveConversationSkillConfig,
    groupedSkillRecords,
    selectableSkillIds,
    selectedSkillIds,
    selectionSummary.mode,
    selectionSummary.selectedSkillCount,
    t,
    topic,
    updateTopic
  ])

  const openQuickPanel = useCallback(() => {
    const items = buildItems()

    open({
      title: t('chat.input.conversation_skills.description', {
        defaultValue: 'Select which installed skills are eligible for this conversation'
      }),
      list: items,
      symbol: CONVERSATION_SKILLS_SYMBOL,
      multiple: true
    })
  }, [buildItems, open, t])

  useEffect(() => {
    if (isVisible && symbol === CONVERSATION_SKILLS_SYMBOL) {
      updateList(buildItems())
    }
  }, [buildItems, isVisible, symbol, updateList])

  useEffect(() => {
    const disposeMenu = registerRootMenu([
      {
        label: t('chat.input.conversation_skills.title', {
          defaultValue: 'Conversation Skills'
        }),
        description: t('chat.input.conversation_skills.description', {
          defaultValue: 'Select which installed skills are eligible for this conversation'
        }),
        icon: <Zap size={16} />,
        isMenu: true,
        action: ({ context }) => {
          context.close('select')
          setTimeout(() => {
            openQuickPanel()
          }, 0)
        }
      }
    ])

    return () => {
      disposeMenu()
    }
  }, [openQuickPanel, registerRootMenu, t])

  return {
    handleOpenQuickPanel: () => {
      logger.debug('Opening conversation skills quick panel', { topicId: topic.id })
      openQuickPanel()
    }
  }
}

export default useConversationSkillsPanel
