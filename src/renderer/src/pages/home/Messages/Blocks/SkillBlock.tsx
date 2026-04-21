import { CheckOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { MessageBlockStatus, type SkillMessageBlock } from '@renderer/types/newMessage'
import { SkillSelectionMethod } from '@renderer/types/skillConfig'
import { Collapse, Tag, Tooltip } from 'antd'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('SkillBlock')

interface Props {
  block: SkillMessageBlock
}

const methodColorMap: Record<SkillSelectionMethod, string> = {
  [SkillSelectionMethod.KEYWORD]: 'orange',
  [SkillSelectionMethod.EMBEDDING]: 'blue',
  [SkillSelectionMethod.HYBRID]: 'purple',
  [SkillSelectionMethod.LLM_DELEGATED]: 'green',
  [SkillSelectionMethod.LLM_ROUTER]: 'cyan',
  [SkillSelectionMethod.TWO_STAGE]: 'geekblue'
}

const SkillBlock: React.FC<Props> = ({ block }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const isStreaming = useMemo(() => block.status === MessageBlockStatus.STREAMING, [block.status])
  const isCompleted = useMemo(() => block.status === MessageBlockStatus.SUCCESS, [block.status])
  const [activeKey, setActiveKey] = useState<'skill' | ''>(isStreaming ? 'skill' : '')

  useEffect(() => {
    if (isStreaming) {
      setActiveKey('skill')
    }
  }, [isStreaming])

  const copyContent = useCallback(() => {
    if (block.content) {
      navigator.clipboard
        .writeText(block.content)
        .then(() => {
          window.toast.success({ title: t('message.copied'), key: 'copy-skill-content' })
          setCopied(true)
        })
        .catch((error) => {
          logger.error('Failed to copy skill content:', error)
          window.toast.error({ title: t('message.copy.failed'), key: 'copy-skill-content-error' })
        })
    }
  }, [block.content, setCopied, t])

  const methodColor = methodColorMap[block.activationMethod] ?? 'default'
  const methodLabel = block.activationMethod.toUpperCase().replaceAll('_', ' ')

  const headerLabel = (
    <HeaderLabel>
      <SkillIcon className="iconfont icon-skill" />
      <SkillName>{block.skillName}</SkillName>
      <Tag color={methodColor}>{methodLabel}</Tag>
      {block.similarityScore !== undefined && <SimilarityScore>{block.similarityScore.toFixed(2)}</SimilarityScore>}
    </HeaderLabel>
  )

  return (
    <CollapseContainer
      activeKey={isStreaming ? 'skill' : activeKey}
      size="small"
      onChange={() => {
        if (!isStreaming) {
          setActiveKey((key) => (key ? '' : 'skill'))
        }
      }}
      className="message-skill-container"
      ghost
      items={[
        {
          key: 'skill',
          label: headerLabel,
          children: (
            <SkillContent>
              {isCompleted && block.content && (
                <Tooltip title={t('common.copy')} mouseEnterDelay={0.8}>
                  <ActionButton
                    className="message-action-button"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyContent()
                    }}
                    aria-label={t('common.copy')}>
                    {!copied && <i className="iconfont icon-copy"></i>}
                    {copied && <CheckOutlined style={{ color: 'var(--color-primary)' }} />}
                  </ActionButton>
                </Tooltip>
              )}
              <MetaSection>
                <MetaRow>
                  <MetaLabel>{t('message.block.skill.skill_id')}:</MetaLabel>
                  <MetaValue>{block.skillId}</MetaValue>
                </MetaRow>
                {block.selectionReason && (
                  <MetaRow>
                    <MetaLabel>{t('message.block.skill.selection_reason')}:</MetaLabel>
                    <MetaValue>{block.selectionReason}</MetaValue>
                  </MetaRow>
                )}
                {block.triggerTokens && block.triggerTokens.length > 0 && (
                  <MetaRow>
                    <MetaLabel>{t('message.block.skill.trigger_tokens')}:</MetaLabel>
                    <TagsWrapper>
                      {block.triggerTokens.map((token) => (
                        <Tag key={token}>{token}</Tag>
                      ))}
                    </TagsWrapper>
                  </MetaRow>
                )}
                {block.originalTokenCount !== undefined && (
                  <MetaRow>
                    <MetaLabel>{t('message.block.skill.original_tokens')}:</MetaLabel>
                    <MetaValue>{block.originalTokenCount.toLocaleString()}</MetaValue>
                  </MetaRow>
                )}
                <MetaRow>
                  <MetaLabel>{t('message.block.skill.managed_tokens')}:</MetaLabel>
                  <MetaValue>{(block.managedTokenCount ?? block.tokenCount).toLocaleString()}</MetaValue>
                  {block.truncated && <Tag color="orange">{t('error.truncatedBadge')}</Tag>}
                </MetaRow>
                <MetaRow>
                  <MetaLabel>{t('message.block.skill.tokens_saved')}:</MetaLabel>
                  <MetaValue>{block.tokensSaved.toLocaleString()}</MetaValue>
                </MetaRow>
                {block.contextManagementMethod && (
                  <MetaRow>
                    <MetaLabel>{t('message.block.skill.context_method')}:</MetaLabel>
                    <MetaValue>{block.contextManagementMethod.toUpperCase().replaceAll('_', ' ')}</MetaValue>
                  </MetaRow>
                )}
              </MetaSection>
              {block.content && (
                <ContentSection>
                  <ContentLabel>{t('message.block.skill.injected_content')}</ContentLabel>
                  <ContentText>{block.content}</ContentText>
                </ContentSection>
              )}
            </SkillContent>
          ),
          showArrow: !isStreaming
        }
      ]}
    />
  )
}

const CollapseContainer = styled(Collapse)`
  margin-bottom: 15px;
  .ant-collapse-header {
    padding: 0 !important;
  }
  .ant-collapse-content-box {
    padding: 16px !important;
    border-width: 0 0.5px 0.5px 0.5px;
    border-style: solid;
    border-color: var(--color-border);
    border-radius: 0 0 12px 12px;
  }
`

const HeaderLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

const SkillIcon = styled.i`
  font-size: 14px;
  color: var(--color-primary);
`

const SkillName = styled.span`
  font-weight: 500;
  color: var(--color-text);
`

const SimilarityScore = styled.span`
  font-size: 12px;
  color: var(--color-text-2);
  opacity: 0.8;
`

const SkillContent = styled.div`
  position: relative;
`

const MetaSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
`

const MetaRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 6px;
  flex-wrap: wrap;
`

const MetaLabel = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-2);
  white-space: nowrap;
  padding-top: 2px;
`

const MetaValue = styled.span`
  font-size: 12px;
  color: var(--color-text);
`

const TagsWrapper = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`

const ContentSection = styled.div`
  border-top: 0.5px solid var(--color-border);
  padding-top: 10px;
  margin-top: 4px;
`

const ContentLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-2);
  margin-bottom: 6px;
`

const ContentText = styled.pre`
  font-size: 12px;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: var(--font-family);
  max-height: 240px;
  overflow-y: auto;
`

const ActionButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-2);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  opacity: 0.6;
  transition: all 0.3s;
  position: absolute;
  right: -12px;
  top: -12px;

  &:hover {
    opacity: 1;
    color: var(--color-text);
  }

  &:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  .iconfont {
    font-size: 14px;
  }
`

export default memo(SkillBlock)
