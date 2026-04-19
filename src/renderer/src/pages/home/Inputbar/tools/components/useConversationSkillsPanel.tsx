import { loggerService } from '@logger'
import type { QuickPanelListItem } from '@renderer/components/QuickPanel'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import type { ToolQuickPanelApi, ToolQuickPanelController } from '@renderer/pages/home/Inputbar/types'
import {
  buildConversationSkillOverride,
  getSkillSelectionSummary,
  isSkillSelectableWithinBaseConfig
} from '@renderer/services/skills/scopedSkillSelection'
import { useAppSelector } from '@renderer/store'
import type { Assistant, Topic } from '@renderer/types'
import { DEFAULT_SKILL_CONFIG, hasSkillConfigOverride, resolveSkillConfig } from '@renderer/types/skillConfig'
import { Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
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

  const baseSkillConfig = useMemo(
    () => resolveSkillConfig(globalSkillConfig, assistant.settings?.skillConfig),
    [assistant.settings?.skillConfig, globalSkillConfig]
  )
  const effectiveConversationSkillConfig = useMemo(
    () => resolveSkillConfig(baseSkillConfig, topic.skillConfig),
    [baseSkillConfig, topic.skillConfig]
  )
  const enabledSkills = useMemo(() => skills.filter((skill) => skill.isEnabled), [skills])
  const selectionSummary = useMemo(
    () => getSkillSelectionSummary(effectiveConversationSkillConfig, enabledSkills),
    [effectiveConversationSkillConfig, enabledSkills]
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

    const skillItems = enabledSkills.map((skill) => {
      const selectable = isSkillSelectableWithinBaseConfig(baseSkillConfig, skill.id)

      return {
        label: skill.name,
        description: selectable
          ? skill.description || ''
          : t('chat.input.conversation_skills.locked_by_assistant', {
              defaultValue: 'Excluded by assistant defaults'
            }),
        icon: <Zap size={16} />,
        filterText: `${skill.name} ${skill.description || ''} ${skill.folderName}`,
        isSelected: effectiveConversationSkillConfig.selectedSkillIds?.includes(skill.id) ?? false,
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

    return [statusItem, ...skillItems]
  }, [
    baseSkillConfig,
    effectiveConversationSkillConfig,
    enabledSkills,
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
