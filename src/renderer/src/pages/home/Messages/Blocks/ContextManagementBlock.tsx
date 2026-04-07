import type { ContextManagementMessageBlock } from '@renderer/types/newMessage'
import type { CollapseProps } from 'antd'
import { Collapse } from 'antd'
import { ChevronDown, Layers } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  block: ContextManagementMessageBlock
}

const ContextManagementBlock: React.FC<Props> = ({ block }) => {
  const { t } = useTranslation()
  const p = block.payload

  const items: CollapseProps['items'] = [
    {
      key: 'ctx',
      label: (
        <TitleWrapper>
          <Layers size={16} />
          <TitleText>{t('message.message.contextManagement.title')}</TitleText>
        </TitleWrapper>
      ),
      children: (
        <Body>
          <Row>
            <strong>{t('message.message.contextManagement.trigger')}</strong> {p.trigger}
          </Row>
          <Row>
            <strong>
              {p.surface === 'agent'
                ? t('message.message.contextManagement.agent')
                : t('message.message.contextManagement.assistant')}
            </strong>{' '}
            ({p.strategyType})
          </Row>
          <Row>{p.alterationSummary}</Row>
          {p.originalMessageCount !== undefined && p.finalMessageCount !== undefined && (
            <Row>
              {t('message.message.contextManagement.messageCounts')}: {p.originalMessageCount} → {p.finalMessageCount}
              {typeof p.messagesRemoved === 'number' && p.messagesRemoved > 0 ? ` (${p.messagesRemoved} removed)` : ''}
            </Row>
          )}
          {typeof p.tokensSaved === 'number' && p.tokensSaved > 0 && (
            <Row>
              {t('message.message.contextManagement.tokensSaved')}: ~{p.tokensSaved}
            </Row>
          )}
          {typeof p.tokensBefore === 'number' && (
            <Row>
              {t('message.message.contextManagement.tokensBefore')}: {p.tokensBefore}
            </Row>
          )}
          {typeof p.tokensAfter === 'number' && (
            <Row>
              {t('message.message.contextManagement.tokensAfter')}: {p.tokensAfter}
            </Row>
          )}
          {p.summaryPreview && (
            <SummaryBox>
              <strong>{t('message.message.contextManagement.summaryPreview')}</strong>
              <pre>{p.summaryPreview}</pre>
            </SummaryBox>
          )}
        </Body>
      )
    }
  ]

  return (
    <Container>
      <StyledCollapse items={items} expandIcon={() => <ChevronDown size={16} />} />
    </Container>
  )
}

const Container = styled.div`
  margin: 8px 0;
`

const StyledCollapse = styled(Collapse)`
  border-radius: 8px;
`

const TitleWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const TitleText = styled.span`
  font-weight: 500;
  font-size: 14px;
  color: var(--color-text-1);
`

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-2);
  line-height: 1.5;
`

const Row = styled.div``

const SummaryBox = styled.div`
  margin-top: 8px;
  pre {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 12px;
    margin: 6px 0 0;
  }
`

export default ContextManagementBlock
