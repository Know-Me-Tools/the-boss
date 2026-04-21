import { HStack } from '@renderer/components/Layout'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { SettingRow } from '@renderer/pages/settings'
import { useAppSelector } from '@renderer/store'
import type { Assistant } from '@renderer/types'
import { DEFAULT_SKILL_CONFIG, resolveSkillConfig } from '@renderer/types/skillConfig'
import { Button } from 'antd'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { getSkillSelectionSummary } from '../../../services/skills/scopedSkillSelection'

interface Props {
  assistant: Assistant
  onConfigure?: () => void
}

const AssistantSkillSettingsSummary: FC<Props> = ({ assistant, onConfigure }) => {
  const { t } = useTranslation()
  const globalSkillConfig = useAppSelector((state) => state.skillConfig?.global || DEFAULT_SKILL_CONFIG)
  const { skills } = useInstalledSkills()

  const effectiveSkillConfig = useMemo(
    () => resolveSkillConfig(globalSkillConfig, assistant.settings?.skillConfig),
    [assistant.settings?.skillConfig, globalSkillConfig]
  )
  const selectionSummary = useMemo(
    () => getSkillSelectionSummary(effectiveSkillConfig, skills),
    [effectiveSkillConfig, skills]
  )

  const selectionSummaryLabel = useMemo(() => {
    if (selectionSummary.mode === 'none') {
      return t('settings.skills.summary.none', {
        defaultValue: 'Disable all skills'
      })
    }

    if (selectionSummary.mode === 'custom') {
      return t('settings.skills.summary.custom', {
        defaultValue: 'Selected skills only · {{count}} selected',
        count: selectionSummary.selectedSkillCount
      })
    }

    return t('settings.skills.summary.all', {
      defaultValue: 'All enabled skills · {{count}} available',
      count: selectionSummary.enabledSkillCount
    })
  }, [selectionSummary, t])

  const selectionMethodLabel = useMemo(() => {
    switch (effectiveSkillConfig.selectionMethod) {
      case 'embedding':
        return t('settings.skill.method.embedding.label', { defaultValue: 'Embedding (Semantic)' })
      case 'hybrid':
        return t('settings.skill.method.hybrid.label', { defaultValue: 'Hybrid' })
      case 'two_stage':
        return t('settings.skill.method.two_stage.label', { defaultValue: 'Two-Stage' })
      case 'llm_router':
        return t('settings.skill.method.llm_router.label', { defaultValue: 'LLM Router' })
      case 'llm_delegated':
        return t('settings.skill.method.llm_delegated.label', { defaultValue: 'LLM Delegated' })
      default:
        return effectiveSkillConfig.selectionMethod
    }
  }, [effectiveSkillConfig.selectionMethod, t])

  const contextMethodLabel = useMemo(() => {
    switch (effectiveSkillConfig.contextManagementMethod) {
      case 'full_injection':
        return t('settings.skill.context.full_injection', { defaultValue: 'Full Injection' })
      case 'prefix_cache_aware':
        return t('settings.skill.context.prefix_cache_aware', { defaultValue: 'Prefix Cache Aware' })
      case 'chunked_rag':
        return t('settings.skill.context.chunked_rag', { defaultValue: 'Chunked RAG' })
      case 'summarized':
        return t('settings.skill.context.summarized', { defaultValue: 'Summarized' })
      case 'progressive':
        return t('settings.skill.context.progressive', { defaultValue: 'Progressive' })
      default:
        return effectiveSkillConfig.contextManagementMethod
    }
  }, [effectiveSkillConfig.contextManagementMethod, t])

  return (
    <SettingRow style={{ minHeight: 30 }}>
      <div className="flex min-w-0 flex-col gap-1">
        <span style={{ color: 'var(--color-text)', fontSize: 14, fontWeight: 500 }}>
          {t('agent.settings.skills.tab', {
            defaultValue: 'Skills'
          })}
        </span>
        <span style={{ color: 'var(--color-text-2)', fontSize: 12 }}>{selectionSummaryLabel}</span>
        <HStack gap={10} style={{ flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--color-text-3)', fontSize: 12 }}>
            {t('settings.skills.summary.selectionMethod', {
              defaultValue: 'Selection: {{method}}',
              method: selectionMethodLabel
            })}
          </span>
          <span style={{ color: 'var(--color-text-3)', fontSize: 12 }}>
            {t('settings.skills.summary.contextMethod', {
              defaultValue: 'Context: {{strategy}}',
              strategy: contextMethodLabel
            })}
          </span>
        </HStack>
      </div>
      <Button onClick={onConfigure}>{t('settings.contextStrategy.configure', { defaultValue: 'Configure' })}</Button>
    </SettingRow>
  )
}

export default AssistantSkillSettingsSummary
