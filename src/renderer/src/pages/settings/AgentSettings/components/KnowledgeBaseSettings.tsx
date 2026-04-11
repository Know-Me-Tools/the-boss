import { CheckOutlined } from '@ant-design/icons'
import { useAppSelector } from '@renderer/store'
import type { KnowledgeBase, UpdateAgentBaseForm } from '@renderer/types'
import type { SelectProps } from 'antd'
import { Row, Segmented, Select, Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { AgentOrSessionSettingsProps } from '../shared'
import { SettingsContainer, SettingsTitle } from '../shared'

const KnowledgeBaseSettings: React.FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()
  const knowledgeBases = useAppSelector((state) => state.knowledge.bases)

  if (!agentBase) {
    return null
  }

  const knowledgeOptions: SelectProps['options'] = knowledgeBases.map((base) => ({
    label: base.name,
    value: base.id
  }))

  const handleKnowledgeBaseChange = (value: string[]) => {
    const selectedBases = value
      .map((id) => knowledgeBases.find((base) => base.id === id))
      .filter((base): base is KnowledgeBase => Boolean(base))

    void update(
      {
        id: agentBase.id,
        knowledge_bases: selectedBases
      } satisfies UpdateAgentBaseForm,
      { showSuccessToast: false }
    )
  }

  const handleRecognitionChange = (value: string | number) => {
    void update(
      {
        id: agentBase.id,
        knowledgeRecognition: value as 'off' | 'on'
      } satisfies UpdateAgentBaseForm,
      { showSuccessToast: false }
    )
  }

  return (
    <SettingsContainer>
      <SettingsTitle>{t('common.knowledge_base')}</SettingsTitle>
      <Select
        mode="multiple"
        allowClear
        maxTagCount="responsive"
        value={agentBase.knowledge_bases?.map((base) => base.id)}
        placeholder={t('assistants.presets.add.knowledge_base.placeholder')}
        menuItemSelectedIcon={<CheckOutlined />}
        options={knowledgeOptions}
        onChange={handleKnowledgeBaseChange}
        style={{ width: '100%' }}
        filterOption={(input, option) =>
          String(option?.label ?? '')
            .toLowerCase()
            .includes(input.toLowerCase())
        }
      />

      <Row align="middle" style={{ marginTop: 16 }}>
        <Label>{t('assistants.settings.knowledge_base.recognition.label')}</Label>
      </Row>
      <Row align="middle" style={{ marginTop: 10 }}>
        <Segmented
          value={agentBase.knowledgeRecognition ?? 'off'}
          options={[
            { label: t('assistants.settings.knowledge_base.recognition.off'), value: 'off' },
            {
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {t('assistants.settings.knowledge_base.recognition.on')}
                  <Tooltip title={t('assistants.settings.knowledge_base.recognition.tip')}>
                    <QuestionIcon size={15} />
                  </Tooltip>
                </div>
              ),
              value: 'on'
            }
          ]}
          onChange={handleRecognitionChange}
        />
      </Row>
    </SettingsContainer>
  )
}

const Label = styled.p`
  margin-right: 5px;
  font-weight: 500;
`

const QuestionIcon = styled(CircleHelp)`
  cursor: pointer;
  color: var(--color-text-3);
`

export default KnowledgeBaseSettings
