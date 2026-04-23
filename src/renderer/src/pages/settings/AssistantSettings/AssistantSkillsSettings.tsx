import { useTheme } from '@renderer/context/ThemeProvider'
import ContextSkillsPanel from '@renderer/pages/settings/components/ContextSkillsPanel'
import { useAppSelector } from '@renderer/store'
import { selectGlobalSkillConfig } from '@renderer/store/skillConfig'
import type { Assistant } from '@renderer/types'
import type { SkillScopeConfigRow, SkillScopeRef } from '@renderer/types'
import {
  deriveSkillConfigOverride,
  hasSkillConfigOverride,
  resolveSkillConfig,
  type SkillConfigOverride
} from '@renderer/types/skillConfig'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  assistant: Assistant
}

const AssistantSkillsSettings: FC<Props> = ({ assistant }) => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const globalSkillConfig = useAppSelector(selectGlobalSkillConfig)
  const [scopeRow, setScopeRow] = useState<SkillScopeConfigRow | null | undefined>(undefined)

  const scope = useMemo<SkillScopeRef>(() => ({ type: 'assistant', id: assistant.id }), [assistant.id])

  useEffect(() => {
    let disposed = false
    setScopeRow(undefined)

    window.api.skillScope
      .getConfig(scope)
      .then((result) => {
        if (!disposed) {
          setScopeRow(result.success ? result.data : null)
        }
      })
      .catch(() => {
        if (!disposed) {
          setScopeRow(null)
        }
      })

    return () => {
      disposed = true
    }
  }, [scope])

  const scopeOverride = scopeRow ? scopeRow.config : assistant.settings?.skillConfig
  const skillConfig = resolveSkillConfig(globalSkillConfig, scopeOverride)
  const useInherited = scopeRow ? !hasSkillConfigOverride(scopeRow.config) : !hasSkillConfigOverride(scopeOverride)

  const persistScopeConfig = async (config: SkillConfigOverride | null) => {
    const result = await window.api.skillScope.setConfig({ scope, config })
    if (result.success) {
      setScopeRow(result.data)
    }
  }

  if (scopeRow === undefined) {
    return null
  }

  return (
    <ContextSkillsPanel
      theme={theme}
      skillConfig={skillConfig}
      skillScopes={scope}
      showInheritOption
      useInherited={useInherited}
      onInheritedChange={(nextUseInherited) => {
        if (nextUseInherited) {
          void persistScopeConfig(null)
        } else {
          // Snapshot the currently resolved (= global) config as the assistant
          // override so controls unlock immediately with the inherited values
          // pre-populated, ready for the user to edit.
          const snapshot = deriveSkillConfigOverride(globalSkillConfig, skillConfig)
          void persistScopeConfig(snapshot ?? {})
        }
      }}
      inheritLabel={t('settings.skill.useGlobalDefault', { defaultValue: 'Use Global Default' })}
      onSkillConfigChange={(patch) => {
        const nextSkillConfig = resolveSkillConfig(skillConfig, patch)
        const nextOverride = deriveSkillConfigOverride(globalSkillConfig, nextSkillConfig)
        void persistScopeConfig(nextOverride ?? null)
      }}
      title={t('settings.skill.title', { defaultValue: 'Skills' })}
      description={t('settings.skill.assistantDescription', {
        defaultValue:
          'Choose which installed skills are eligible for this assistant. Conversation-specific overrides can narrow this set.'
      })}
    />
  )
}

export default AssistantSkillsSettings
