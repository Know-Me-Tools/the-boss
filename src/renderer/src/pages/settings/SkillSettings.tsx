import { useTheme } from '@renderer/context/ThemeProvider'
import ContextSkillsPanel from '@renderer/pages/settings/components/ContextSkillsPanel'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setAgentContextStrategy } from '@renderer/store/settings'
import { selectGlobalSkillConfig, setGlobalSkillConfig } from '@renderer/store/skillConfig'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const SkillSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const globalConfig = useAppSelector(selectGlobalSkillConfig)
  const agentContextStrategy = useAppSelector((state) => state.settings.agentContextStrategy)

  return (
    <ContextSkillsPanel
      theme={theme}
      skillConfig={globalConfig}
      onSkillConfigChange={(patch) => dispatch(setGlobalSkillConfig(patch))}
      agentContextStrategy={agentContextStrategy}
      onAgentContextStrategyChange={(config) => dispatch(setAgentContextStrategy(config))}
      title={t('settings.skill.title')}
      description={t('settings.contextStrategy.globalDescription', {
        defaultValue:
          'Global defaults for skill activation, skill context handling, and agent SDK compaction thresholds.'
      })}
    />
  )
}

export default SkillSettings
