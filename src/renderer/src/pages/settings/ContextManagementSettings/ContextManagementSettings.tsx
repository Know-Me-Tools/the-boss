import { InfoTooltip, RowFlex, SpaceBetweenRowFlex, Switch } from '@cherrystudio/ui'
import ContextStrategySelector from '@renderer/components/ContextStrategySelector'
import ModelSelector from '@renderer/components/ModelSelector'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useProviders } from '@renderer/hooks/useProvider'
import { useAppDispatch } from '@renderer/store'
import {
  setAgentContextStrategy,
  setAgentContextSummarizationModelId,
  setContextStrategy,
  setContextSummarizationModelId
} from '@renderer/store/settings'
import type { Model } from '@renderer/types'
import type { ContextStrategyConfig } from '@renderer/types/contextStrategy'
import { DEFAULT_AGENT_CONTEXT_STRATEGY_CONFIG, DEFAULT_CONTEXT_STRATEGY_CONFIG } from '@renderer/types/contextStrategy'
import { Badge } from 'antd'
import { find } from 'lodash'
import { Bot, Layers, Sparkles } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import {
  SettingContainer,
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '../index'

/**
 * Global Context Management Settings Page
 *
 * Allows users to configure the default context management strategy
 * that applies to all conversations unless overridden at the assistant
 * or topic level.
 */
const ContextManagementSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { providers } = useProviders()

  const contextStrategy = useSelector(
    (state: { settings: { contextStrategy: ContextStrategyConfig } }) => state.settings.contextStrategy
  )

  const contextSummarizationModelId = useSelector(
    (state: { settings: { contextSummarizationModelId?: string } }) => state.settings.contextSummarizationModelId
  )

  const agentContextStrategy = useSelector(
    (state: { settings: { agentContextStrategy: ContextStrategyConfig } }) => state.settings.agentContextStrategy
  )

  const agentContextSummarizationModelId = useSelector(
    (state: { settings: { agentContextSummarizationModelId?: string | null } }) =>
      state.settings.agentContextSummarizationModelId
  )

  // Use defaults if not set
  const strategy = contextStrategy || DEFAULT_CONTEXT_STRATEGY_CONFIG
  const isEnabled = strategy.type !== 'none'

  const agentStrategy = agentContextStrategy || DEFAULT_AGENT_CONTEXT_STRATEGY_CONFIG
  const isAgentEnabled = agentStrategy.type !== 'none'

  const allModels = providers.map((p) => p.models).flat()

  // Filter to only chat models (exclude embedding, rerank, image models)
  const modelPredicate = useCallback(
    (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m) && !isTextToImageModel(m),
    []
  )

  // Get current summarization model value for the selector
  const summarizationModelValue = useMemo(() => {
    if (!contextSummarizationModelId) return undefined
    const model = find(allModels, (m) => m.id === contextSummarizationModelId)
    return model ? JSON.stringify({ id: model.id, provider: model.provider }) : undefined
  }, [contextSummarizationModelId, allModels])

  const agentSummarizationModelValue = useMemo(() => {
    if (!agentContextSummarizationModelId) return undefined
    const model = find(allModels, (m) => m.id === agentContextSummarizationModelId)
    return model ? JSON.stringify({ id: model.id, provider: model.provider }) : undefined
  }, [agentContextSummarizationModelId, allModels])

  const handleStrategyChange = (config: ContextStrategyConfig) => {
    dispatch(setContextStrategy(config))
  }

  const handleEnableToggle = (enabled: boolean) => {
    if (enabled) {
      // Enable with default strategy (sliding_window)
      dispatch(setContextStrategy({ ...strategy, type: 'sliding_window' }))
    } else {
      // Disable
      dispatch(setContextStrategy({ ...strategy, type: 'none' }))
    }
  }

  const handleSummarizationModelChange = (value: string) => {
    const modelData = JSON.parse(value)
    dispatch(setContextSummarizationModelId(modelData.id))
  }

  const handleAgentStrategyChange = (config: ContextStrategyConfig) => {
    dispatch(setAgentContextStrategy(config))
  }

  const handleAgentEnableToggle = (enabled: boolean) => {
    if (enabled) {
      dispatch(setAgentContextStrategy({ ...agentStrategy, type: 'sliding_window' }))
    } else {
      dispatch(setAgentContextStrategy({ ...agentStrategy, type: 'none' }))
    }
  }

  const handleAgentSummarizationModelChange = (value: string) => {
    const modelData = JSON.parse(value)
    dispatch(setAgentContextSummarizationModelId(modelData.id))
  }

  return (
    <SettingContainer theme={theme}>
      {/* Enable/Disable Section */}
      <SettingGroup theme={theme}>
        <SpaceBetweenRowFlex className="items-center">
          <RowFlex className="items-center gap-2.5">
            <Layers size={18} color="var(--color-text)" />
            <SettingRowTitle style={{ fontWeight: 'bold' }}>
              {t('settings.contextStrategy.title', { defaultValue: 'Context Management' })}
            </SettingRowTitle>
            <Badge
              count={isEnabled ? t('common.on', { defaultValue: 'ON' }) : t('common.off', { defaultValue: 'OFF' })}
              style={{
                backgroundColor: isEnabled ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                fontSize: 10
              }}
            />
          </RowFlex>
          <Switch checked={isEnabled} onCheckedChange={handleEnableToggle} />
        </SpaceBetweenRowFlex>
        <SettingDescription>
          {t('settings.contextStrategy.globalDescription', {
            defaultValue:
              'Automatically manages conversation context to prevent exceeding model limits. This setting applies globally and can be overridden per assistant or conversation.'
          })}
        </SettingDescription>
      </SettingGroup>

      {/* Strategy Configuration */}
      {isEnabled && (
        <SettingGroup theme={theme}>
          <SettingTitle style={{ marginBottom: 16 }}>
            <RowFlex className="items-center gap-2.5">
              {t('settings.contextStrategy.configuration', { defaultValue: 'Strategy Configuration' })}
              <InfoTooltip
                content={t('settings.contextStrategy.configurationHelp', {
                  defaultValue:
                    'Configure how context is managed when conversations approach model limits. Different strategies offer different tradeoffs between context preservation and token efficiency.'
                })}
              />
            </RowFlex>
          </SettingTitle>
          <ContextStrategySelector value={strategy} onChange={handleStrategyChange} />
        </SettingGroup>
      )}

      {/* Summarization Model Selection */}
      {isEnabled && (strategy.type === 'summarize' || strategy.type === 'hierarchical') && (
        <SettingGroup theme={theme}>
          <SettingTitle style={{ marginBottom: 16 }}>
            <RowFlex className="items-center gap-2.5">
              <Sparkles size={16} color="var(--color-text)" />
              {t('settings.contextStrategy.summarizationModel', { defaultValue: 'Summarization Model' })}
              <InfoTooltip
                content={t('settings.contextStrategy.summarizationModelHelp', {
                  defaultValue:
                    'Select a fast, lightweight model for generating summaries. Recommended: Claude Haiku, GPT-3.5 Turbo, or similar quick models.'
                })}
              />
            </RowFlex>
          </SettingTitle>
          <SettingRow>
            <SettingRowTitle>{t('settings.contextStrategy.selectModel', { defaultValue: 'Model' })}</SettingRowTitle>
            <ModelSelector
              providers={providers}
              predicate={modelPredicate}
              value={summarizationModelValue}
              defaultValue={summarizationModelValue}
              style={{ width: 300 }}
              onChange={handleSummarizationModelChange}
              placeholder={t('settings.contextStrategy.selectModelPlaceholder', {
                defaultValue: 'Select summarization model'
              })}
            />
          </SettingRow>
          <SettingDivider />
          <SettingDescription>
            {t('settings.contextStrategy.summarizationModelDescription', {
              defaultValue:
                'This model will be used to generate conversation summaries. Choose a fast model to minimize latency. If not set, the current conversation model will be used.'
            })}
          </SettingDescription>
        </SettingGroup>
      )}

      {/* Agent sessions (Claude Code SDK) */}
      <SettingGroup theme={theme}>
        <SpaceBetweenRowFlex className="items-center">
          <RowFlex className="items-center gap-2.5">
            <Bot size={18} color="var(--color-text)" />
            <SettingRowTitle style={{ fontWeight: 'bold' }}>
              {t('settings.contextStrategy.agentSessionsTitle', { defaultValue: 'Agent context (SDK sessions)' })}
            </SettingRowTitle>
            <Badge
              count={isAgentEnabled ? t('common.on', { defaultValue: 'ON' }) : t('common.off', { defaultValue: 'OFF' })}
              style={{
                backgroundColor: isAgentEnabled ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                fontSize: 10
              }}
            />
          </RowFlex>
          <Switch checked={isAgentEnabled} onCheckedChange={handleAgentEnableToggle} />
        </SpaceBetweenRowFlex>
        <SettingDescription>
          {t('settings.contextStrategy.agentSessionsDescription', {
            defaultValue:
              'Optional defaults for autonomous agents. Per-agent and per-session settings can override. Uses SDK resume and may run /compact when token usage exceeds your threshold.'
          })}
        </SettingDescription>
      </SettingGroup>

      {isAgentEnabled && (
        <SettingGroup theme={theme}>
          <SettingTitle style={{ marginBottom: 16 }}>
            {t('settings.contextStrategy.agentConfiguration', { defaultValue: 'Agent strategy defaults' })}
          </SettingTitle>
          <ContextStrategySelector variant="agent" value={agentStrategy} onChange={handleAgentStrategyChange} />
        </SettingGroup>
      )}

      {isAgentEnabled && (agentStrategy.type === 'summarize' || agentStrategy.type === 'hierarchical') && (
        <SettingGroup theme={theme}>
          <SettingTitle style={{ marginBottom: 16 }}>
            <RowFlex className="items-center gap-2.5">
              <Sparkles size={16} color="var(--color-text)" />
              {t('settings.contextStrategy.agentSummarizationModel', { defaultValue: 'Agent summarization model' })}
            </RowFlex>
          </SettingTitle>
          <SettingRow>
            <SettingRowTitle>{t('settings.contextStrategy.selectModel', { defaultValue: 'Model' })}</SettingRowTitle>
            <ModelSelector
              providers={providers}
              predicate={modelPredicate}
              value={agentSummarizationModelValue}
              defaultValue={agentSummarizationModelValue}
              style={{ width: 300 }}
              onChange={handleAgentSummarizationModelChange}
              placeholder={t('settings.contextStrategy.selectModelPlaceholder', {
                defaultValue: 'Select summarization model'
              })}
            />
          </SettingRow>
        </SettingGroup>
      )}

      {/* Information Section */}
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          {t('settings.contextStrategy.howItWorks', { defaultValue: 'How It Works' })}
        </SettingTitle>
        <InfoBox>
          <InfoItem>
            <InfoLabel>
              {t('settings.contextStrategy.types.sliding_window', { defaultValue: 'Sliding Window' })}
            </InfoLabel>
            <InfoText>
              {t('settings.contextStrategy.descriptions.sliding_window', {
                defaultValue: 'Keeps only the most recent messages within the token budget. Simple and predictable.'
              })}
            </InfoText>
          </InfoItem>
          <InfoItem>
            <InfoLabel>
              {t('settings.contextStrategy.types.summarize', { defaultValue: 'Progressive Summarization' })}
            </InfoLabel>
            <InfoText>
              {t('settings.contextStrategy.descriptions.summarize', {
                defaultValue:
                  'Progressively summarizes older messages to preserve key information while reducing tokens.'
              })}
            </InfoText>
          </InfoItem>
          <InfoItem>
            <InfoLabel>
              {t('settings.contextStrategy.types.hierarchical', { defaultValue: 'Hierarchical Memory' })}
            </InfoLabel>
            <InfoText>
              {t('settings.contextStrategy.descriptions.hierarchical', {
                defaultValue:
                  'Three-tier memory system: recent messages verbatim, older messages summarized, key facts extracted.'
              })}
            </InfoText>
          </InfoItem>
          <InfoItem>
            <InfoLabel>
              {t('settings.contextStrategy.types.truncate_middle', { defaultValue: 'Keep First & Last' })}
            </InfoLabel>
            <InfoText>
              {t('settings.contextStrategy.descriptions.truncate_middle', {
                defaultValue: 'Preserves initial instructions and recent context, removes middle messages.'
              })}
            </InfoText>
          </InfoItem>
        </InfoBox>
      </SettingGroup>
    </SettingContainer>
  )
}

import styled from 'styled-components'

const InfoBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const InfoItem = styled.div`
  padding: 12px;
  background: var(--color-background-soft);
  border-radius: 8px;
  border: 1px solid var(--color-border);
`

const InfoLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 4px;
`

const InfoText = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
`

export default ContextManagementSettings
