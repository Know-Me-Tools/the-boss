import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { selectGlobalSkillConfig, setGlobalSkillConfig } from '@renderer/store/skillConfig'
import { ContextManagementMethod, SkillSelectionMethod } from '@renderer/types/skillConfig'
import { Col, InputNumber, Row, Select, Slider } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

const SkillSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const globalConfig = useAppSelector(selectGlobalSkillConfig)

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

  return (
    <SettingContainer theme={theme}>
      <SettingTitle>{t('settings.skill.title')}</SettingTitle>
      <SettingGroup theme={theme}>
        <SettingRow>
          <SettingRowTitle>{t('settings.skill.selection_method')}</SettingRowTitle>
          <Select
            value={globalConfig.selectionMethod}
            options={selectionMethodOptions}
            style={{ width: 220 }}
            onChange={(value) => dispatch(setGlobalSkillConfig({ selectionMethod: value }))}
          />
        </SettingRow>
        <SettingRow>
          <SettingRowTitle>{t('settings.skill.similarity_threshold')}</SettingRowTitle>
          <Row align="middle" gutter={12} style={{ flex: 1, maxWidth: 340 }}>
            <Col span={16}>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={globalConfig.similarityThreshold}
                marks={{ 0: '0', 0.35: '0.35', 1: '1' }}
                onChange={(value) => dispatch(setGlobalSkillConfig({ similarityThreshold: value }))}
              />
            </Col>
            <Col span={8}>
              <InputNumber
                min={0}
                max={1}
                step={0.05}
                precision={2}
                value={globalConfig.similarityThreshold}
                style={{ width: '100%' }}
                onChange={(value) => {
                  if (value !== null) {
                    dispatch(setGlobalSkillConfig({ similarityThreshold: value }))
                  }
                }}
              />
            </Col>
          </Row>
        </SettingRow>
        <SettingRow>
          <SettingRowTitle>{t('settings.skill.top_k')}</SettingRowTitle>
          <InputNumber
            min={1}
            max={20}
            step={1}
            value={globalConfig.topK}
            style={{ width: 100 }}
            onChange={(value) => {
              if (value !== null) {
                dispatch(setGlobalSkillConfig({ topK: value }))
              }
            }}
          />
        </SettingRow>
        <SettingRow>
          <SettingRowTitle>{t('settings.skill.context_method')}</SettingRowTitle>
          <Select
            value={globalConfig.contextManagementMethod}
            options={contextMethodOptions}
            style={{ width: 220 }}
            onChange={(value) => dispatch(setGlobalSkillConfig({ contextManagementMethod: value }))}
          />
        </SettingRow>
        <SettingRow>
          <SettingRowTitle>{t('settings.skill.max_tokens')}</SettingRowTitle>
          <InputNumber
            min={256}
            max={16384}
            step={256}
            value={globalConfig.maxSkillTokens}
            style={{ width: 120 }}
            onChange={(value) => {
              if (value !== null) {
                dispatch(setGlobalSkillConfig({ maxSkillTokens: value }))
              }
            }}
          />
        </SettingRow>
      </SettingGroup>
    </SettingContainer>
  )
}

export default SkillSettings
