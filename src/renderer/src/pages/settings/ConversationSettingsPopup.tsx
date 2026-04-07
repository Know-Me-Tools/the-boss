import { TopView } from '@renderer/components/TopView'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistant } from '@renderer/hooks/useAssistant'
import ContextSkillsPanel from '@renderer/pages/settings/components/ContextSkillsPanel'
import { useAppSelector } from '@renderer/store'
import { selectGlobalSkillConfig } from '@renderer/store/skillConfig'
import { deriveSkillConfigOverride, resolveSkillConfig } from '@renderer/types/skillConfig'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseSettingsPopup, type SettingsMenuItem } from './AgentSettings/BaseSettingsPopup'

interface ConversationSettingsPopupShowParams {
  assistantId: string
  topicId: string
}

interface ConversationSettingsPopupParams extends ConversationSettingsPopupShowParams {
  resolve: () => void
}

const ConversationSettingsPopupContainer: FC<ConversationSettingsPopupParams> = ({ assistantId, topicId, resolve }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { assistant, updateTopic } = useAssistant(assistantId)
  const globalSkillConfig = useAppSelector(selectGlobalSkillConfig)

  const topic = useMemo(() => assistant?.topics.find((item) => item.id === topicId), [assistant?.topics, topicId])
  const skillConfig = resolveSkillConfig(globalSkillConfig, topic?.skillConfig)

  const menuItems: SettingsMenuItem[] = [
    { key: 'context-skills', label: t('agent.settings.contextSkills.tab', 'Context & Skills') }
  ]

  const renderTabContent = () => {
    if (!topic) {
      return null
    }

    return (
      <ContextSkillsPanel
        theme={theme}
        skillConfig={skillConfig}
        onSkillConfigChange={(patch) => {
          const nextSkillConfig = resolveSkillConfig(skillConfig, patch)
          const nextOverride = deriveSkillConfigOverride(globalSkillConfig, nextSkillConfig)

          updateTopic({
            ...topic,
            skillConfig: nextOverride
          })
        }}
        title={t('agent.settings.contextSkills.tab', 'Context & Skills')}
        description={t('settings.contextStrategy.globalDescription', {
          defaultValue:
            'Override the global skill-selection and prompt-side context defaults for this conversation only.'
        })}
      />
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
  }
}
