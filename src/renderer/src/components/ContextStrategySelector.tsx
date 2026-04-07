import { InfoTooltip, RowFlex, Switch } from '@cherrystudio/ui'
import Selector from '@renderer/components/Selector'
import { useSettings } from '@renderer/hooks/useSettings'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import type { ContextStrategyConfig, ContextStrategyType } from '@renderer/types/contextStrategy'
import {
  CONTEXT_STRATEGY_DESCRIPTIONS,
  CONTEXT_STRATEGY_LABELS,
  DEFAULT_CONTEXT_STRATEGY_CONFIG
} from '@renderer/types/contextStrategy'

/** Agent Phase 1: only none + SDK compaction (threshold); other chat strategy names are not implemented for agents yet. */
const AGENT_PHASE1_STRATEGY_TYPES: ContextStrategyType[] = ['none', 'sliding_window']

const STRATEGY_TYPE_I18N_KEY: Record<ContextStrategyType, string> = {
  none: 'settings.contextStrategy.types.none',
  sliding_window: 'settings.contextStrategy.types.sliding_window',
  summarize: 'settings.contextStrategy.types.summarize',
  hierarchical: 'settings.contextStrategy.types.hierarchical',
  truncate_middle: 'settings.contextStrategy.types.truncate_middle'
}

const STRATEGY_DESC_I18N_KEY: Record<ContextStrategyType, string> = {
  none: 'settings.contextStrategy.descriptions.none',
  sliding_window: 'settings.contextStrategy.descriptions.sliding_window',
  summarize: 'settings.contextStrategy.descriptions.summarize',
  hierarchical: 'settings.contextStrategy.descriptions.hierarchical',
  truncate_middle: 'settings.contextStrategy.descriptions.truncate_middle'
}
import { InputNumber, Slider } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ContextStrategySelectorProps {
  /** Current strategy configuration */
  value: ContextStrategyConfig
  /** Callback when configuration changes */
  onChange: (config: ContextStrategyConfig) => void
  /** Agent sessions: show compact threshold and agent-specific help */
  variant?: 'chat' | 'agent'
  /** Whether to show "Use inherited" option */
  showInheritOption?: boolean
  /** If showing inherit option, what is the inherited strategy type */
  inheritedStrategyType?: ContextStrategyType
  /** Label for the inherit option */
  inheritLabel?: string
  /** Whether inheritance is currently enabled */
  useInherited?: boolean
  /** Callback when inheritance toggle changes */
  onInheritedChange?: (useInherited: boolean) => void
  /** Compact mode for smaller spaces */
  compact?: boolean
}

/**
 * Reusable Context Strategy Selector Component
 *
 * Used across Global Settings, Assistant Settings, and Topic Settings
 * to configure context management strategies.
 */
const ContextStrategySelector: FC<ContextStrategySelectorProps> = ({
  value,
  onChange,
  variant = 'chat',
  showInheritOption = false,
  inheritedStrategyType,
  inheritLabel,
  useInherited = false,
  onInheritedChange,
  compact = false
}) => {
  const { t } = useTranslation()
  const { contextSummarizationModelId } = useSettings()

  const strategy = value || DEFAULT_CONTEXT_STRATEGY_CONFIG

  const strategyTypesForVariant: ContextStrategyType[] =
    variant === 'agent' ? AGENT_PHASE1_STRATEGY_TYPES : (Object.keys(CONTEXT_STRATEGY_LABELS) as ContextStrategyType[])

  const agentLegacyUnsupportedType =
    variant === 'agent' && strategy.type !== 'none' && !AGENT_PHASE1_STRATEGY_TYPES.includes(strategy.type)

  const selectorStrategyType: ContextStrategyType =
    variant === 'agent' && agentLegacyUnsupportedType ? 'sliding_window' : strategy.type

  const strategyOptions = strategyTypesForVariant.map((type) => ({
    value: type,
    label:
      variant === 'agent' && type === 'sliding_window'
        ? t('settings.contextStrategy.types.agent_sliding_window', {
            defaultValue: 'SDK compaction (token threshold)'
          })
        : t(STRATEGY_TYPE_I18N_KEY[type], { defaultValue: CONTEXT_STRATEGY_LABELS[type] })
  }))

  const handleStrategyChange = (type: ContextStrategyType) => {
    onChange({ ...strategy, type })
  }

  const strategyTooltipDescription =
    variant === 'agent' && selectorStrategyType === 'sliding_window'
      ? t('settings.contextStrategy.descriptions.agent_sliding_window', {
          defaultValue:
            'Runs the Claude Agent SDK /compact when the last turn’s total token usage reaches your threshold (resumed sessions). This is not the same as chat sliding-window trimming.'
        })
      : t(STRATEGY_DESC_I18N_KEY[selectorStrategyType], {
          defaultValue: CONTEXT_STRATEGY_DESCRIPTIONS[selectorStrategyType]
        })

  const handleConfigChange = (key: keyof ContextStrategyConfig, configValue: number | string | boolean | undefined) => {
    onChange({ ...strategy, [key]: configValue })
  }

  const RowTitle = compact ? CompactRowTitle : SettingRowTitle

  return (
    <Container>
      {/* Inherit Toggle */}
      {showInheritOption && onInheritedChange && (
        <>
          <SettingRow>
            <RowTitle>
              {inheritLabel || t('settings.contextStrategy.useInherited', { defaultValue: 'Use Default' })}
            </RowTitle>
            <Switch size="sm" checked={useInherited} onCheckedChange={onInheritedChange} />
          </SettingRow>
          {useInherited && inheritedStrategyType && (
            <InheritedInfo>
              {t('settings.contextStrategy.inheritedStrategy', { defaultValue: 'Currently using:' })}{' '}
              <strong>
                {t(STRATEGY_TYPE_I18N_KEY[inheritedStrategyType], {
                  defaultValue: CONTEXT_STRATEGY_LABELS[inheritedStrategyType]
                })}
              </strong>
            </InheritedInfo>
          )}
          <SettingDivider />
        </>
      )}

      {/* Strategy Type Selector - only show if not using inherited */}
      {(!showInheritOption || !useInherited) && (
        <>
          <SettingRow>
            <RowTitle>
              {t('settings.contextStrategy.strategy', { defaultValue: 'Strategy' })}
              <InfoTooltip content={strategyTooltipDescription} />
            </RowTitle>
            <Selector value={selectorStrategyType} onChange={handleStrategyChange} options={strategyOptions} />
          </SettingRow>

          {variant === 'agent' && (
            <SettingDescriptionText>
              {t('settings.contextStrategy.agentPhase1Notice', {
                defaultValue:
                  'Agent strategies (Phase 1): enabling a non-None strategy applies a token threshold and may run SDK /compact before your next message. Chat-style summarize/hierarchical pipelines are not applied to SDK sessions yet.'
              })}
            </SettingDescriptionText>
          )}

          {variant === 'agent' && agentLegacyUnsupportedType && (
            <WarningText>
              {t('settings.contextStrategy.agentLegacyStrategyWarning', {
                defaultValue:
                  'This session used a strategy type that is not yet implemented for SDK sessions; threshold + /compact still applies. Saving will use SDK compaction (threshold) going forward.'
              })}
            </WarningText>
          )}

          {variant === 'agent' && strategy.type !== 'none' && (
            <>
              <SettingDivider />
              <SettingRow>
                <RowTitle>
                  {t('settings.contextStrategy.compactTriggerTokens', {
                    defaultValue: 'Compact when prior turn ≥ tokens'
                  })}
                  <InfoTooltip
                    content={t('settings.contextStrategy.compactTriggerTokensHelp', {
                      defaultValue:
                        'Uses the Claude Agent SDK session. When the last turn’s total token usage is at or above this value, /compact runs automatically before your next message (resumed sessions only).'
                    })}
                  />
                </RowTitle>
                <InputNumber
                  min={1000}
                  max={2_000_000}
                  step={1000}
                  value={strategy.compactTriggerTokens}
                  onChange={(val) => handleConfigChange('compactTriggerTokens', val ?? undefined)}
                  placeholder={t('settings.contextStrategy.compactTriggerPlaceholder', {
                    defaultValue: 'Default 180000'
                  })}
                  style={{ width: 140 }}
                  size={compact ? 'small' : 'middle'}
                />
              </SettingRow>
            </>
          )}

          {/* Sliding Window Options */}
          {strategy.type === 'sliding_window' && (
            <>
              <SettingDivider />
              <SettingRow>
                <RowTitle>
                  {t('settings.contextStrategy.maxMessages', { defaultValue: 'Max Messages' })}
                  <InfoTooltip
                    content={t('settings.contextStrategy.maxMessagesHelp', {
                      defaultValue:
                        'Maximum number of messages to keep. Leave empty for automatic (token-based) management.'
                    })}
                  />
                </RowTitle>
                <InputNumber
                  min={1}
                  max={200}
                  value={strategy.maxMessages}
                  onChange={(val) => handleConfigChange('maxMessages', val ?? undefined)}
                  placeholder={t('common.auto', { defaultValue: 'Auto' })}
                  style={{ width: 100 }}
                  size={compact ? 'small' : 'middle'}
                />
              </SettingRow>
            </>
          )}

          {/* Summarization Options */}
          {strategy.type === 'summarize' && (
            <>
              <SettingDivider />
              <SettingRow>
                <RowTitle>
                  {t('settings.contextStrategy.summaryMaxTokens', { defaultValue: 'Summary Budget' })}
                  <InfoTooltip
                    content={t('settings.contextStrategy.summaryMaxTokensHelp', {
                      defaultValue: 'Maximum tokens allocated for the conversation summary.'
                    })}
                  />
                </RowTitle>
                <RowFlex className="items-center gap-3" style={{ flex: 1, maxWidth: compact ? 200 : 300 }}>
                  <Slider
                    min={200}
                    max={2000}
                    step={100}
                    value={strategy.summaryMaxTokens ?? DEFAULT_CONTEXT_STRATEGY_CONFIG.summaryMaxTokens}
                    onChange={(val) => handleConfigChange('summaryMaxTokens', val)}
                    style={{ flex: 1 }}
                  />
                  <span style={{ minWidth: 50, textAlign: 'right' }}>
                    {strategy.summaryMaxTokens ?? DEFAULT_CONTEXT_STRATEGY_CONFIG.summaryMaxTokens}
                  </span>
                </RowFlex>
              </SettingRow>
              <SettingDivider />
              <SettingRow>
                <RowTitle>
                  {t('settings.contextStrategy.summarizeThreshold', {
                    defaultValue: 'Min Messages Before Summarizing'
                  })}
                  <InfoTooltip
                    content={t('settings.contextStrategy.summarizeThresholdHelp', {
                      defaultValue: 'Minimum number of messages before summarization kicks in.'
                    })}
                  />
                </RowTitle>
                <InputNumber
                  min={4}
                  max={20}
                  value={strategy.summarizeThreshold ?? DEFAULT_CONTEXT_STRATEGY_CONFIG.summarizeThreshold}
                  onChange={(val) => handleConfigChange('summarizeThreshold', val ?? undefined)}
                  style={{ width: 100 }}
                  size={compact ? 'small' : 'middle'}
                />
              </SettingRow>
              {!contextSummarizationModelId && (
                <>
                  <SettingDivider />
                  <WarningText>
                    {t('settings.contextStrategy.noSummarizationModel', {
                      defaultValue: 'Note: Configure a summarization model in global settings for best results.'
                    })}
                  </WarningText>
                </>
              )}
            </>
          )}

          {/* Hierarchical Memory Options */}
          {strategy.type === 'hierarchical' && (
            <>
              <SettingDivider />
              <SettingRow>
                <RowTitle>
                  {t('settings.contextStrategy.shortTermTurns', { defaultValue: 'Short-term Turns' })}
                  <InfoTooltip
                    content={t('settings.contextStrategy.shortTermTurnsHelp', {
                      defaultValue: 'Number of recent conversation turns to keep verbatim.'
                    })}
                  />
                </RowTitle>
                <InputNumber
                  min={1}
                  max={20}
                  value={strategy.shortTermTurns ?? DEFAULT_CONTEXT_STRATEGY_CONFIG.shortTermTurns}
                  onChange={(val) => handleConfigChange('shortTermTurns', val ?? undefined)}
                  style={{ width: 100 }}
                  size={compact ? 'small' : 'middle'}
                />
              </SettingRow>
              <SettingDivider />
              <SettingRow>
                <RowTitle>
                  {t('settings.contextStrategy.midTermBudget', { defaultValue: 'Mid-term Budget' })}
                  <InfoTooltip
                    content={t('settings.contextStrategy.midTermBudgetHelp', {
                      defaultValue: 'Token budget for mid-term memory summaries.'
                    })}
                  />
                </RowTitle>
                <RowFlex className="items-center gap-3" style={{ flex: 1, maxWidth: compact ? 200 : 300 }}>
                  <Slider
                    min={500}
                    max={5000}
                    step={100}
                    value={strategy.midTermSummaryTokens ?? DEFAULT_CONTEXT_STRATEGY_CONFIG.midTermSummaryTokens}
                    onChange={(val) => handleConfigChange('midTermSummaryTokens', val)}
                    style={{ flex: 1 }}
                  />
                  <span style={{ minWidth: 50, textAlign: 'right' }}>
                    {strategy.midTermSummaryTokens ?? DEFAULT_CONTEXT_STRATEGY_CONFIG.midTermSummaryTokens}
                  </span>
                </RowFlex>
              </SettingRow>
              <SettingDivider />
              <SettingRow>
                <RowTitle>
                  {t('settings.contextStrategy.longTermBudget', { defaultValue: 'Long-term Budget' })}
                  <InfoTooltip
                    content={t('settings.contextStrategy.longTermBudgetHelp', {
                      defaultValue: 'Token budget for extracted long-term facts and preferences.'
                    })}
                  />
                </RowTitle>
                <RowFlex className="items-center gap-3" style={{ flex: 1, maxWidth: compact ? 200 : 300 }}>
                  <Slider
                    min={100}
                    max={2000}
                    step={100}
                    value={strategy.longTermFactsTokens ?? DEFAULT_CONTEXT_STRATEGY_CONFIG.longTermFactsTokens}
                    onChange={(val) => handleConfigChange('longTermFactsTokens', val)}
                    style={{ flex: 1 }}
                  />
                  <span style={{ minWidth: 50, textAlign: 'right' }}>
                    {strategy.longTermFactsTokens ?? DEFAULT_CONTEXT_STRATEGY_CONFIG.longTermFactsTokens}
                  </span>
                </RowFlex>
              </SettingRow>
            </>
          )}

          {/* Truncate Middle Options */}
          {strategy.type === 'truncate_middle' && (
            <>
              <SettingDivider />
              <SettingRow>
                <RowTitle>
                  {t('settings.contextStrategy.keepFirst', { defaultValue: 'Keep First Messages' })}
                  <InfoTooltip
                    content={t('settings.contextStrategy.keepFirstHelp', {
                      defaultValue: 'Number of initial messages to preserve (system context, instructions).'
                    })}
                  />
                </RowTitle>
                <InputNumber
                  min={1}
                  max={10}
                  value={strategy.keepFirstMessages ?? DEFAULT_CONTEXT_STRATEGY_CONFIG.keepFirstMessages}
                  onChange={(val) => handleConfigChange('keepFirstMessages', val ?? undefined)}
                  style={{ width: 100 }}
                  size={compact ? 'small' : 'middle'}
                />
              </SettingRow>
              <SettingDivider />
              <SettingRow>
                <RowTitle>
                  {t('settings.contextStrategy.keepLast', { defaultValue: 'Keep Last Messages' })}
                  <InfoTooltip
                    content={t('settings.contextStrategy.keepLastHelp', {
                      defaultValue: 'Number of recent messages to preserve.'
                    })}
                  />
                </RowTitle>
                <InputNumber
                  min={1}
                  max={20}
                  value={strategy.keepLastMessages ?? DEFAULT_CONTEXT_STRATEGY_CONFIG.keepLastMessages}
                  onChange={(val) => handleConfigChange('keepLastMessages', val ?? undefined)}
                  style={{ width: 100 }}
                  size={compact ? 'small' : 'middle'}
                />
              </SettingRow>
            </>
          )}
        </>
      )}
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
`

const CompactRowTitle = styled(SettingRowTitle)`
  font-size: 13px;
  gap: 4px;
`

const InheritedInfo = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--color-background-soft);
  border-radius: 6px;
`

const WarningText = styled.div`
  font-size: 12px;
  color: var(--color-warning);
  padding: 8px 12px;
  background: var(--color-warning-bg, rgba(250, 173, 20, 0.1));
  border-radius: 6px;
  border: 1px solid var(--color-warning);
`

const SettingDescriptionText = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
`

export default ContextStrategySelector
