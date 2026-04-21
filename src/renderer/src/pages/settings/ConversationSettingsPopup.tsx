import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistant } from '@renderer/hooks/useAssistant'
import ChatContextPanel from '@renderer/pages/settings/components/ChatContextPanel'
import ContextSkillsPanel from '@renderer/pages/settings/components/ContextSkillsPanel'
import { useAppSelector } from '@renderer/store'
import type { SkillScopeConfigRow, SkillScopeRef } from '@renderer/types'
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
  const assistantSkillScope = useMemo<SkillScopeRef>(() => ({ type: 'assistant', id: assistantId }), [assistantId])
  const topicSkillScope = useMemo<SkillScopeRef>(() => ({ type: 'topic', id: topicId }), [topicId])
  const [assistantSkillScopeRow, setAssistantSkillScopeRow] = useState<SkillScopeConfigRow | null | undefined>(
    undefined
  )
  const [topicSkillScopeRow, setTopicSkillScopeRow] = useState<SkillScopeConfigRow | null | undefined>(undefined)
  const assistantSkillConfig = resolveSkillConfig(
    globalSkillConfig,
    assistantSkillScopeRow ? assistantSkillScopeRow.config : assistant?.settings?.skillConfig
  )
  const topicSkillOverride = topicSkillScopeRow ? topicSkillScopeRow.config : topic?.skillConfig
  const skillConfig = resolveSkillConfig(assistantSkillConfig, topicSkillOverride)
  const assistantContextStrategy = resolveEffectiveChatContextStrategy({
    globalStrategy: globalContextStrategy,
    assistant: assistant?.settings?.contextStrategy
  })
  const persistedInherited = !hasContextStrategyOverride(topic?.contextStrategy)
  const [useInheritedContext, setUseInheritedContext] = useState(persistedInherited)
  const persistedInheritedSkillConfig = !hasSkillConfigOverride(topicSkillOverride)
  const [useInheritedSkillConfig, setUseInheritedSkillConfig] = useState(persistedInheritedSkillConfig)

  useEffect(() => {
    setUseInheritedContext(persistedInherited)
  }, [persistedInherited])

  useEffect(() => {
    setUseInheritedSkillConfig(persistedInheritedSkillConfig)
  }, [persistedInheritedSkillConfig])

  useEffect(() => {
    let disposed = false
    setAssistantSkillScopeRow(undefined)
    setTopicSkillScopeRow(undefined)

    Promise.all([
      window.api.skillScope.getConfig(assistantSkillScope),
      window.api.skillScope.getConfig(topicSkillScope)
    ])
      .then(([assistantResult, topicResult]) => {
        if (disposed) return
        setAssistantSkillScopeRow(assistantResult.success ? assistantResult.data : null)
        setTopicSkillScopeRow(topicResult.success ? topicResult.data : null)
      })
      .catch(() => {
        if (disposed) return
        setAssistantSkillScopeRow(null)
        setTopicSkillScopeRow(null)
      })

    return () => {
      disposed = true
    }
  }, [assistantSkillScope, topicSkillScope])

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
              void window.api.skillScope.setConfig({ scope: topicSkillScope, config: null }).then((result) => {
                if (result.success) {
                  setTopicSkillScopeRow(result.data)
                }
              })
            }
          }}
          inheritLabel={t('settings.skill.useAssistantDefault', {
            defaultValue: 'Use Assistant Default'
          })}
          onSkillConfigChange={(patch) => {
            const nextSkillConfig = resolveSkillConfig(skillConfig, patch)
            const nextOverride = deriveSkillConfigOverride(assistantSkillConfig, nextSkillConfig)

            void window.api.skillScope
              .setConfig({ scope: topicSkillScope, config: nextOverride ?? null })
              .then((result) => {
                if (result.success) {
                  setTopicSkillScopeRow(result.data)
                }
              })
          }}
          skillScopes={[assistantSkillScope, topicSkillScope]}
          title={t('agent.settings.contextSkills.skillsTitle', { defaultValue: 'Skill Context & Selection' })}
          description={t('settings.skill.topicDescription', {
            defaultValue: 'Override the assistant skill-selection defaults for this conversation only.'
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
