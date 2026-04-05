import { HStack } from '@renderer/components/Layout'
import Selector from '@renderer/components/Selector'
import { InfoTooltip } from '@renderer/components/TooltipIcons'
import { useSettings } from '@renderer/hooks/useSettings'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import type { ContextStrategyConfig, ContextStrategyType } from '@renderer/types/contextStrategy'
import {
  CONTEXT_STRATEGY_DESCRIPTIONS,
  CONTEXT_STRATEGY_LABELS,
  DEFAULT_CONTEXT_STRATEGY_CONFIG
} from '@renderer/types/contextStrategy'
import { Switch } from 'antd'
import { InputNumber, Slider } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ContextStrategySelectorProps {
  /** Current strategy configuration */
  value: ContextStrategyConfig
  /** Callback when configuration changes */
  onChange: (config: ContextStrategyConfig) => void
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

  const strategyOptions = (Object.keys(CONTEXT_STRATEGY_LABELS) as ContextStrategyType[]).map((type) => ({
    value: type,
    label: t(`settings.contextStrategy.types.${type}`, { defaultValue: CONTEXT_STRATEGY_LABELS[type] })
  }))

  const handleStrategyChange = (type: ContextStrategyType) => {
    onChange({ ...strategy, type })
  }

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
            <Switch size="small" checked={useInherited} onChange={onInheritedChange} />
          </SettingRow>
          {useInherited && inheritedStrategyType && (
            <InheritedInfo>
              {t('settings.contextStrategy.inheritedStrategy', { defaultValue: 'Currently using:' })}{' '}
              <strong>
                {t(`settings.contextStrategy.types.${inheritedStrategyType}`, {
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
              <InfoTooltip
                title={t(`settings.contextStrategy.descriptions.${strategy.type}`, {
                  defaultValue: CONTEXT_STRATEGY_DESCRIPTIONS[strategy.type]
                })}
              />
            </RowTitle>
            <Selector value={strategy.type} onChange={handleStrategyChange} options={strategyOptions} />
          </SettingRow>

          {/* Sliding Window Options */}
          {strategy.type === 'sliding_window' && (
            <>
              <SettingDivider />
              <SettingRow>
                <RowTitle>
                  {t('settings.contextStrategy.maxMessages', { defaultValue: 'Max Messages' })}
                  <InfoTooltip
                    title={t('settings.contextStrategy.maxMessagesHelp', {
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
                    title={t('settings.contextStrategy.summaryMaxTokensHelp', {
                      defaultValue: 'Maximum tokens allocated for the conversation summary.'
                    })}
                  />
                </RowTitle>
                <HStack alignItems="center" gap={12} style={{ flex: 1, maxWidth: compact ? 200 : 300 }}>
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
                </HStack>
              </SettingRow>
              <SettingDivider />
              <SettingRow>
                <RowTitle>
                  {t('settings.contextStrategy.summarizeThreshold', {
                    defaultValue: 'Min Messages Before Summarizing'
                  })}
                  <InfoTooltip
                    title={t('settings.contextStrategy.summarizeThresholdHelp', {
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
                    title={t('settings.contextStrategy.shortTermTurnsHelp', {
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
                    title={t('settings.contextStrategy.midTermBudgetHelp', {
                      defaultValue: 'Token budget for mid-term memory summaries.'
                    })}
                  />
                </RowTitle>
                <HStack alignItems="center" gap={12} style={{ flex: 1, maxWidth: compact ? 200 : 300 }}>
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
                </HStack>
              </SettingRow>
              <SettingDivider />
              <SettingRow>
                <RowTitle>
                  {t('settings.contextStrategy.longTermBudget', { defaultValue: 'Long-term Budget' })}
                  <InfoTooltip
                    title={t('settings.contextStrategy.longTermBudgetHelp', {
                      defaultValue: 'Token budget for extracted long-term facts and preferences.'
                    })}
                  />
                </RowTitle>
                <HStack alignItems="center" gap={12} style={{ flex: 1, maxWidth: compact ? 200 : 300 }}>
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
                </HStack>
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
                    title={t('settings.contextStrategy.keepFirstHelp', {
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
                    title={t('settings.contextStrategy.keepLastHelp', {
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

export default ContextStrategySelector
