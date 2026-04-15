import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistant } from '@renderer/hooks/useAssistant'
import ChatContextPanel from '@renderer/pages/settings/components/ChatContextPanel'
import ContextSkillsPanel from '@renderer/pages/settings/components/ContextSkillsPanel'
import { useAppSelector } from '@renderer/store'
import type { ContextStrategyConfig } from '@renderer/types/contextStrategy'
import { DEFAULT_CONTEXT_STRATEGY_CONFIG } from '@renderer/types/contextStrategy'
import {
  DEFAULT_SKILL_CONFIG,
  deriveSkillConfigOverride,
  hasSkillConfigOverride,
  resolveSkillConfig
} from '@renderer/types/skillConfig'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  deriveContextStrategyOverride,
  hasContextStrategyOverride,
  resolveEffectiveChatContextStrategy
} from '../../services/chatContextStrategy'
import { BaseSettingsPopup, type SettingsMenuItem } from './AgentSettings/BaseSettingsPopup'

interface ConversationSettingsPopupShowParams {
  assistantId: string
  topicId: string
}

interface ConversationSettingsPopupParams extends ConversationSettingsPopupShowParams {
  resolve: () => void
}

export const ConversationSettingsPopupContainer: FC<ConversationSettingsPopupParams> = ({
  assistantId,
  topicId,
  resolve
}) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { assistant, updateTopic } = useAssistant(assistantId)
  const globalSkillConfig = useAppSelector((state) => state.skillConfig?.global || DEFAULT_SKILL_CONFIG)
  const globalContextStrategy = useAppSelector(
    (state) => state.settings.contextStrategy || DEFAULT_CONTEXT_STRATEGY_CONFIG
  )

  const topic = useMemo(() => assistant?.topics.find((item) => item.id === topicId), [assistant?.topics, topicId])
  const assistantSkillConfig = resolveSkillConfig(globalSkillConfig, assistant?.settings?.skillConfig)
  const skillConfig = resolveSkillConfig(assistantSkillConfig, topic?.skillConfig)
  const assistantContextStrategy = resolveEffectiveChatContextStrategy({
    globalStrategy: globalContextStrategy,
    assistant: assistant?.settings?.contextStrategy
  })
  const persistedInherited = !hasContextStrategyOverride(topic?.contextStrategy)
  const [useInheritedContext, setUseInheritedContext] = useState(persistedInherited)
  const persistedInheritedSkillConfig = !hasSkillConfigOverride(topic?.skillConfig)
  const [useInheritedSkillConfig, setUseInheritedSkillConfig] = useState(persistedInheritedSkillConfig)

  useEffect(() => {
    setUseInheritedContext(persistedInherited)
  }, [persistedInherited])

  useEffect(() => {
    setUseInheritedSkillConfig(persistedInheritedSkillConfig)
  }, [persistedInheritedSkillConfig])

  const effectiveTopicContextStrategy = useMemo(
    () =>
      resolveEffectiveChatContextStrategy({
        globalStrategy: globalContextStrategy,
        assistant: assistant?.settings?.contextStrategy,
        topic: topic?.contextStrategy
      }),
    [assistant?.settings?.contextStrategy, globalContextStrategy, topic?.contextStrategy]
  )

  const menuItems: SettingsMenuItem[] = [
    { key: 'context-skills', label: t('agent.settings.contextSkills.tab', 'Context & Skills') }
  ]

  const renderTabContent = () => {
    if (!topic) {
      return null
    }

    return (
      <div className="flex flex-col gap-4">
        <ChatContextPanel
          theme={theme}
          strategy={effectiveTopicContextStrategy}
          onStrategyChange={(nextStrategy: ContextStrategyConfig) => {
            const nextOverride = deriveContextStrategyOverride(assistantContextStrategy, nextStrategy)

            updateTopic({
              ...topic,
              contextStrategy: nextOverride
            })
            setUseInheritedContext(!nextOverride)
          }}
          showInheritOption
          useInherited={useInheritedContext}
          onInheritedChange={(nextUseInherited) => {
            setUseInheritedContext(nextUseInherited)

            if (nextUseInherited) {
              updateTopic({
                ...topic,
                contextStrategy: undefined
              })
            }
          }}
          inheritedStrategyType={assistantContextStrategy.type}
          inheritLabel={t('settings.contextStrategy.useAssistantDefault', {
            defaultValue: 'Use Assistant Default'
          })}
          title={t('settings.contextStrategy.title', { defaultValue: 'Chat Context Management' })}
          description={t('settings.contextStrategy.topicDescription', {
            defaultValue: 'Override the assistant chat context strategy for this conversation only.'
          })}
        />
        <ContextSkillsPanel
          theme={theme}
          skillConfig={skillConfig}
          showInheritOption
          useInherited={useInheritedSkillConfig}
          onInheritedChange={(nextUseInherited) => {
            setUseInheritedSkillConfig(nextUseInherited)

            if (nextUseInherited) {
              updateTopic({
                ...topic,
                skillConfig: undefined
              })
            }
          }}
          inheritLabel={t('settings.skill.useAssistantDefault', {
            defaultValue: 'Use Assistant Default'
          })}
          onSkillConfigChange={(patch) => {
            const nextSkillConfig = resolveSkillConfig(skillConfig, patch)
            const nextOverride = deriveSkillConfigOverride(assistantSkillConfig, nextSkillConfig)

            updateTopic({
              ...topic,
              skillConfig: nextOverride
            })
            setUseInheritedSkillConfig(!nextOverride)
          }}
          title={t('agent.settings.contextSkills.skillsTitle', { defaultValue: 'Skill Context & Selection' })}
          description={t('settings.skill.topicDescription', {
            defaultValue:
              'Override the assistant skill-selection defaults for this conversation only.'
          })}
        />
      </div>
    )
  }

  return (
    <BaseSettingsPopup
      isLoading={!assistant}
      error={null}
      initialTab="context-skills"
      onClose={resolve}
      titleContent={topic?.name || t('chat.default.topic.name')}
      menuItems={menuItems}
      renderTabContent={renderTabContent}
    />
  )
}

export default class ConversationSettingsPopup {
  static show(props: ConversationSettingsPopupShowParams) {
    return new Promise<void>((resolve) => {
      void import('@renderer/components/TopView').then(({ TopView }) => {
        TopView.show(
          <ConversationSettingsPopupContainer
            {...props}
            resolve={() => {
              resolve()
              TopView.hide('ConversationSettingsPopup')
            }}
          />,
          'ConversationSettingsPopup'
        )
      })
    })
  }
}
