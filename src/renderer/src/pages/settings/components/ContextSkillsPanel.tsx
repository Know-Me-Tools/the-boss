import ContextStrategySelector from '@renderer/components/ContextStrategySelector'
import ModelSelector from '@renderer/components/ModelSelector'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { ThemeMode } from '@renderer/types'
import type { Model } from '@renderer/types'
import type { ContextStrategyConfig } from '@renderer/types/contextStrategy'
import { DEFAULT_AGENT_CONTEXT_STRATEGY_CONFIG } from '@renderer/types/contextStrategy'
import type { SkillConfigOverride, SkillGlobalConfig } from '@renderer/types/skillConfig'
import {
  ContextManagementMethod,
  getSelectedSkillMethodConfig,
  getSkillMethodSimilarityThreshold,
  isLlmSelectionMethod,
  SkillSelectionMethod,
  usesSimilarityThreshold
} from '@renderer/types/skillConfig'
import { Col, InputNumber, Row, Select, Slider } from 'antd'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDescription, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

interface ContextSkillsPanelProps {
  theme?: ThemeMode
  skillConfig: SkillGlobalConfig
  onSkillConfigChange: (patch: SkillConfigOverride) => void
  agentContextStrategy?: ContextStrategyConfig
  onAgentContextStrategyChange?: (config: ContextStrategyConfig) => void
  title?: string
  description?: string
}

const ContextSkillsPanel: FC<ContextSkillsPanelProps> = ({
  theme,
  skillConfig,
  onSkillConfigChange,
  agentContextStrategy,
  onAgentContextStrategyChange,
  title,
  description
}) => {
  const { t } = useTranslation()
  const { providers } = useProviders()

  const selectionMethodOptions = [
    { value: SkillSelectionMethod.EMBEDDING, label: t('settings.skill.method.embedding') },
    { value: SkillSelectionMethod.HYBRID, label: t('settings.skill.method.hybrid') },
    { value: SkillSelectionMethod.LLM_ROUTER, label: t('settings.skill.method.llm_router') },
    { value: SkillSelectionMethod.TWO_STAGE, label: t('settings.skill.method.two_stage') },
    { value: SkillSelectionMethod.LLM_DELEGATED, label: t('settings.skill.method.llm_delegated') }
  ]

  const contextMethodOptions = [
    { value: ContextManagementMethod.FULL_INJECTION, label: t('settings.skill.context.full_injection') },
    { value: ContextManagementMethod.PREFIX_CACHE_AWARE, label: t('settings.skill.context.prefix_cache_aware') },
    { value: ContextManagementMethod.CHUNKED_RAG, label: t('settings.skill.context.chunked_rag') },
    { value: ContextManagementMethod.SUMMARIZED, label: t('settings.skill.context.summarized') },
    { value: ContextManagementMethod.PROGRESSIVE, label: t('settings.skill.context.progressive') }
  ]

  const selectedMethod = skillConfig.selectionMethod
  const selectedMethodConfig = getSelectedSkillMethodConfig(skillConfig)
  const enabledModels = useMemo<Model[]>(() => providers.flatMap((provider) => provider.models), [providers])
  const similarityThreshold = usesSimilarityThreshold(selectedMethod)
    ? getSkillMethodSimilarityThreshold(skillConfig, selectedMethod)
    : undefined

  const llmModelSelectorValue = useMemo(
    () =>
      toModelSelectorValue(
        ('llmModelId' in selectedMethodConfig ? selectedMethodConfig.llmModelId : undefined) || undefined,
        enabledModels
      ),
    [enabledModels, selectedMethodConfig]
  )

  const embeddingModelSelectorValue = useMemo(
    () =>
      toModelSelectorValue(
        ('embeddingModelId' in selectedMethodConfig ? selectedMethodConfig.embeddingModelId : undefined) || undefined,
        enabledModels
      ),
    [enabledModels, selectedMethodConfig]
  )

  const methodPatch = (patch: Record<string, number | string | undefined>): SkillConfigOverride => ({
    methods: {
      [selectedMethod]: patch
    }
  })

  const selectionMethodDescription = getSelectionMethodDescription(t, selectedMethod)

  return (
    <SettingContainer theme={theme}>
      <SettingTitle>{title || t('settings.skill.title')}</SettingTitle>
      {description && <SettingDescription>{description}</SettingDescription>}
      <SettingGroup theme={theme}>
        <SettingRow>
          <SettingRowTitle>{t('settings.skill.selection_method')}</SettingRowTitle>
          <Select
            value={selectedMethod}
            options={selectionMethodOptions}
            style={{ width: 220 }}
            onChange={(value) => onSkillConfigChange({ selectionMethod: value })}
          />
        </SettingRow>
        <SettingDescription>{selectionMethodDescription}</SettingDescription>

        <SettingRow>
          <SettingRowTitle>
            {t('settings.skill.embedding_model', {
              defaultValue: 'Embedding Model'
            })}
          </SettingRowTitle>
          <ModelSelector
            providers={providers}
            predicate={isEmbeddingModel}
            value={embeddingModelSelectorValue}
            style={{ width: 280 }}
            allowClear
            placeholder={t('settings.skill.embedding_model.placeholder', {
              defaultValue: 'Use fastembed default'
            })}
            onChange={(value) => onSkillConfigChange(methodPatch({ embeddingModelId: value || undefined }))}
          />
        </SettingRow>

        {isLlmSelectionMethod(selectedMethod) && (
          <SettingRow>
            <SettingRowTitle>
              {t('settings.skill.routing_model', {
                defaultValue: 'Routing LLM Model'
              })}
            </SettingRowTitle>
            <ModelSelector
              providers={providers}
              predicate={isSelectableLlmModel}
              value={llmModelSelectorValue}
              style={{ width: 280 }}
              allowClear
              placeholder={t('settings.skill.routing_model.placeholder', {
                defaultValue: 'Use current chat or agent model'
              })}
              onChange={(value) => onSkillConfigChange(methodPatch({ llmModelId: value || undefined }))}
            />
          </SettingRow>
        )}

        {usesSimilarityThreshold(selectedMethod) && (
          <SettingRow>
            <SettingRowTitle>{t('settings.skill.similarity_threshold')}</SettingRowTitle>
            <Row align="middle" gutter={12} style={{ flex: 1, maxWidth: 340 }}>
              <Col span={16}>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={similarityThreshold}
                  marks={{ 0: '0', 0.35: '0.35', 1: '1' }}
                  onChange={(value) => onSkillConfigChange(methodPatch({ similarityThreshold: value }))}
                />
              </Col>
              <Col span={8}>
                <InputNumber
                  min={0}
                  max={1}
                  step={0.05}
                  precision={2}
                  value={similarityThreshold}
                  style={{ width: '100%' }}
                  onChange={(value) => {
                    if (value !== null) {
                      onSkillConfigChange(methodPatch({ similarityThreshold: value }))
                    }
                  }}
                />
              </Col>
            </Row>
          </SettingRow>
        )}

        <SettingRow>
          <SettingRowTitle>{t('settings.skill.top_k')}</SettingRowTitle>
          <InputNumber
            min={1}
            max={20}
            step={1}
            value={selectedMethodConfig.topK}
            style={{ width: 100 }}
            onChange={(value) => {
              if (value !== null) {
                onSkillConfigChange(methodPatch({ topK: value }))
              }
            }}
          />
        </SettingRow>

        <SettingRow>
          <SettingRowTitle>{t('settings.skill.context_method')}</SettingRowTitle>
          <Select
            value={skillConfig.contextManagementMethod}
            options={contextMethodOptions}
            style={{ width: 220 }}
            onChange={(value) => onSkillConfigChange({ contextManagementMethod: value })}
          />
        </SettingRow>

        <SettingRow>
          <SettingRowTitle>{t('settings.skill.max_tokens')}</SettingRowTitle>
          <InputNumber
            min={256}
            max={16384}
            step={256}
            value={skillConfig.maxSkillTokens}
            style={{ width: 120 }}
            onChange={(value) => {
              if (value !== null) {
                onSkillConfigChange({ maxSkillTokens: value })
              }
            }}
          />
        </SettingRow>
      </SettingGroup>

      {onAgentContextStrategyChange && (
        <SettingGroup theme={theme}>
          <SettingTitle>
            {t('settings.contextStrategy.agentConfiguration', { defaultValue: 'Agent context' })}
          </SettingTitle>
          <SettingDescription>
            {t('settings.contextStrategy.agentSessionsDescription', {
              defaultValue:
                'Optional SDK-session defaults. A non-None strategy enables token-threshold-based SDK compaction before the next turn.'
            })}
          </SettingDescription>
          <div style={{ marginTop: 12 }}>
            <ContextStrategySelector
              variant="agent"
              value={agentContextStrategy || DEFAULT_AGENT_CONTEXT_STRATEGY_CONFIG}
              onChange={onAgentContextStrategyChange}
            />
          </div>
        </SettingGroup>
      )}
    </SettingContainer>
  )
}

function isSelectableLlmModel(model: Model) {
  return !isEmbeddingModel(model) && !isRerankModel(model) && !isTextToImageModel(model)
}

function toModelSelectorValue(modelId: string | undefined, models: Model[]) {
  if (!modelId) {
    return undefined
  }

  if (looksLikeSerializedModelRef(modelId)) {
    return modelId
  }

  const matchedModel = models.find((model) => model.id === modelId)
  return matchedModel ? getModelUniqId(matchedModel) : undefined
}

function looksLikeSerializedModelRef(value: string): boolean {
  if (!value.startsWith('{')) {
    return false
  }

  try {
    const parsed = JSON.parse(value)
    return typeof parsed?.id === 'string'
  } catch {
    return false
  }
}

function getSelectionMethodDescription(
  t: ReturnType<typeof useTranslation>['t'],
  method: SkillSelectionMethod
): string {
  switch (method) {
    case SkillSelectionMethod.EMBEDDING:
      return t('settings.skill.method.embedding.description', {
        defaultValue:
          'Pure semantic retrieval. Uses the selected embedding model to score every skill and activate the top matches.'
      })
    case SkillSelectionMethod.HYBRID:
      return t('settings.skill.method.hybrid.description', {
        defaultValue:
          'Reciprocal-rank fusion of keyword and dense retrieval. Useful when exact terms matter as much as semantic similarity.'
      })
    case SkillSelectionMethod.TWO_STAGE:
      return t('settings.skill.method.two_stage.description', {
        defaultValue:
          'Keyword and BM25 candidate generation followed by embedding re-ranking. Good when you want tighter candidate filtering before dense scoring.'
      })
    case SkillSelectionMethod.LLM_ROUTER:
      return t('settings.skill.method.llm_router.description', {
        defaultValue:
          'Embedding prefilter plus an LLM router that ranks candidate skills. If no routing model is chosen, the current chat or agent model is used.'
      })
    case SkillSelectionMethod.LLM_DELEGATED:
      return t('settings.skill.method.llm_delegated.description', {
        defaultValue:
          'Embedding prefilter plus an LLM that selects the final skills and explains why. If no delegation model is chosen, the current chat or agent model is used.'
      })
  }
}

export default ContextSkillsPanel
