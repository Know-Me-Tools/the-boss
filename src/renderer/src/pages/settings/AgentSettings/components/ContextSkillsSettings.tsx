import { useTheme } from '@renderer/context/ThemeProvider'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import ContextSkillsPanel from '@renderer/pages/settings/components/ContextSkillsPanel'
import { useAppSelector } from '@renderer/store'
import { selectGlobalSkillConfig } from '@renderer/store/skillConfig'
import { type AgentConfiguration, AgentConfigurationSchema } from '@renderer/types'
import type { ContextStrategyConfig } from '@renderer/types/contextStrategy'
import { DEFAULT_AGENT_CONTEXT_STRATEGY_CONFIG } from '@renderer/types/contextStrategy'
import { deriveSkillConfigOverride, hasSkillConfigOverride, resolveSkillConfig } from '@renderer/types/skillConfig'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentOrSessionSettingsProps } from '../shared'

const ContextSkillsSettings: FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const globalSkillConfig = useAppSelector(selectGlobalSkillConfig)
  const parentAgentId = agentBase && 'agent_id' in agentBase ? agentBase.agent_id : null
  const { agent: parentAgent, isLoading: isParentAgentLoading } = useAgent(parentAgentId)
  const configuration = AgentConfigurationSchema.parse(agentBase?.configuration ?? {})
  const parentAgentConfiguration =
    parentAgent && agentBase && 'agent_id' in agentBase ? AgentConfigurationSchema.parse(parentAgent.configuration ?? {}) : undefined
  const baseSkillConfig =
    parentAgentConfiguration && agentBase && 'agent_id' in agentBase
      ? resolveSkillConfig(globalSkillConfig, parentAgentConfiguration.skill_config)
      : globalSkillConfig
  const skillConfig = resolveSkillConfig(baseSkillConfig, configuration.skill_config)
  const agentContextStrategy = {
    ...DEFAULT_AGENT_CONTEXT_STRATEGY_CONFIG,
    ...configuration.context_strategy
  } as ContextStrategyConfig
  const persistedInheritedSkillConfig = !hasSkillConfigOverride(configuration.skill_config)
  const [useInheritedSkillConfig, setUseInheritedSkillConfig] = useState(persistedInheritedSkillConfig)

  useEffect(() => {
    setUseInheritedSkillConfig(persistedInheritedSkillConfig)
  }, [persistedInheritedSkillConfig])

  if (!agentBase) {
    return null
  }

  if (parentAgentId && isParentAgentLoading) {
    return null
  }

  const updateConfiguration = (nextConfiguration: AgentConfiguration) => {
    void update(
      {
        id: agentBase.id,
        configuration: nextConfiguration
      },
      { showSuccessToast: false }
    )
  }

  return (
    <ContextSkillsPanel
      theme={theme}
      skillConfig={skillConfig}
      showInheritOption
      useInherited={useInheritedSkillConfig}
      onInheritedChange={(nextUseInherited) => {
        setUseInheritedSkillConfig(nextUseInherited)

        if (nextUseInherited) {
          updateConfiguration({
            ...configuration,
            skill_config: undefined
          })
        }
      }}
      inheritLabel={t(
        parentAgentId ? 'settings.skill.useAgentDefault' : 'settings.skill.useGlobalDefault',
        {
          defaultValue: parentAgentId ? 'Use Agent Default' : 'Use Global Default'
        }
      )}
      onSkillConfigChange={(patch) => {
        const nextSkillConfig = resolveSkillConfig(skillConfig, patch)
        const nextOverride = deriveSkillConfigOverride(baseSkillConfig, nextSkillConfig)

        updateConfiguration({
          ...configuration,
          skill_config: nextOverride
        })
        setUseInheritedSkillConfig(!nextOverride)
      }}
      agentContextStrategy={agentContextStrategy}
      onAgentContextStrategyChange={(config) =>
        updateConfiguration({
          ...configuration,
          context_strategy: config
        })
      }
      title={t('agent.settings.contextSkills.tab', 'Context & Skills')}
      description={t('settings.contextStrategy.agentSessionsDescription', {
        defaultValue:
          'Override the global defaults for this agent or session. Skill settings affect prompt-side skill injection; agent context settings affect SDK-session compaction.'
      })}
    />
  )
}

export default ContextSkillsSettings
