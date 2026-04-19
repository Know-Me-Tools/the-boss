import type { RuntimeMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { Alert, Button, Tag } from 'antd'
import { Cpu, ShieldQuestion } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  block: RuntimeMessageBlock
}

const statusColor: Record<MessageBlockStatus, string> = {
  [MessageBlockStatus.PENDING]: 'default',
  [MessageBlockStatus.PROCESSING]: 'processing',
  [MessageBlockStatus.STREAMING]: 'processing',
  [MessageBlockStatus.SUCCESS]: 'success',
  [MessageBlockStatus.ERROR]: 'error',
  [MessageBlockStatus.PAUSED]: 'warning'
}

const RuntimeBlock: React.FC<Props> = ({ block }) => {
  const { t } = useTranslation()
  const latestEvent = block.events.at(-1)
  const visibleEvents = useMemo(() => block.events.slice(-4), [block.events])
  const highlights = useMemo(() => buildRuntimeHighlights(block, t), [block, t])
  const latestError = latestEvent?.eventKind === 'error' ? getReadableRuntimeError(latestEvent.data) : undefined
  const [approvalPendingResponse, setApprovalPendingResponse] = useState<string | null>(null)
  const [approvalMessage, setApprovalMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const debugPayload = useMemo(
    () =>
      JSON.stringify(
        block.events.map((event) => event.data),
        null,
        2
      ),
    [block.events]
  )

  return (
    <Container className="message-runtime-container">
      <Header>
        <Title>
          <Cpu size={15} />
          <RuntimeName>{block.runtime ?? t('message.block.runtime.unknown_runtime')}</RuntimeName>
          <Tag color={statusColor[block.status]}>{block.status}</Tag>
        </Title>
        {block.sessionId && <SessionId>{block.sessionId}</SessionId>}
      </Header>

      {latestEvent && (
        <LatestEvent>
          <EventTitle>{latestEvent.title ?? latestEvent.eventKind}</EventTitle>
          {latestEvent.summary && <EventSummary>{latestEvent.summary}</EventSummary>}
        </LatestEvent>
      )}

      {latestError && <ErrorText>{latestError}</ErrorText>}

      {highlights.length > 0 && (
        <HighlightRow>
          {highlights.map((item) => (
            <Tag key={`${item.label}-${item.value}`}>
              {item.label}: {item.value}
            </Tag>
          ))}
        </HighlightRow>
      )}

      {block.approval?.responses?.length ? (
        <ApprovalRow>
          <ApprovalLabel>
            <ShieldQuestion size={14} />
            {block.approval.permissionId ?? block.approval.kind ?? t('message.block.runtime.approval')}
          </ApprovalLabel>
          <ApprovalActions>
            {block.approval.responses.map((response) => (
              <Button
                key={response}
                size="small"
                aria-label={response}
                loading={approvalPendingResponse === response}
                disabled={Boolean(approvalPendingResponse)}
                onClick={() => {
                  void respondToRuntimeApproval({
                    block,
                    response,
                    setApprovalPendingResponse,
                    setApprovalMessage
                  })
                }}>
                {response}
              </Button>
            ))}
          </ApprovalActions>
        </ApprovalRow>
      ) : null}

      {approvalMessage && (
        <Alert className="mt-1" type={approvalMessage.type} showIcon message={approvalMessage.text} />
      )}

      {visibleEvents.length > 1 && (
        <EventList>
          {visibleEvents.map((event, index) => (
            <EventRow key={`${event.createdAt}-${index}`}>
              <EventKind>{event.eventKind}</EventKind>
              <span>{event.title ?? event.summary ?? event.runtime ?? '-'}</span>
            </EventRow>
          ))}
        </EventList>
      )}

      <DebugDetails>
        <summary>{t('message.block.runtime.debug')}</summary>
        <DebugPayload>{debugPayload}</DebugPayload>
      </DebugDetails>
    </Container>
  )
}

async function respondToRuntimeApproval({
  block,
  response,
  setApprovalPendingResponse,
  setApprovalMessage
}: {
  block: RuntimeMessageBlock
  response: string
  setApprovalPendingResponse: (response: string | null) => void
  setApprovalMessage: (message: { type: 'success' | 'error'; text: string } | null) => void
}): Promise<void> {
  const runtime = block.runtime
  const sessionId = block.sessionId
  const permissionId = block.approval?.permissionId
  if (!runtime || !sessionId || !permissionId) {
    setApprovalMessage({
      type: 'error',
      text: 'Runtime approval is missing runtime, session, or permission metadata.'
    })
    return
  }

  setApprovalPendingResponse(response)
  setApprovalMessage(null)
  try {
    const result = await window.api.agentRuntime.respondToApproval({
      runtime: runtime as Parameters<typeof window.api.agentRuntime.respondToApproval>[0]['runtime'],
      sessionId,
      permissionId,
      response
    })
    setApprovalMessage({
      type: result.success ? 'success' : 'error',
      text: result.message ?? (result.success ? 'Approval response sent.' : 'Approval response failed.')
    })
  } catch (error) {
    setApprovalMessage({
      type: 'error',
      text: error instanceof Error ? error.message : 'Approval response failed.'
    })
  } finally {
    setApprovalPendingResponse(null)
  }
}

function buildRuntimeHighlights(block: RuntimeMessageBlock, t: (key: string) => string) {
  const highlights: { label: string; value: string }[] = []
  const latestData = block.events.at(-1)?.data ?? {}
  const firstData = block.events[0]?.data ?? {}
  const config = isRecord(firstData.config) ? firstData.config : isRecord(latestData.config) ? latestData.config : {}
  const context = isRecord(firstData.context)
    ? firstData.context
    : isRecord(latestData.context)
      ? latestData.context
      : {}
  const status = isRecord(latestData.status) ? latestData.status : {}

  addHighlight(highlights, t('message.block.runtime.model'), stringValue(config.model) ?? stringValue(latestData.model))
  addHighlight(
    highlights,
    t('message.block.runtime.provider'),
    stringValue(latestData.provider) ?? stringValue(latestData.providerId)
  )
  addHighlight(highlights, t('message.block.runtime.mode'), stringValue(latestData.mode) ?? stringValue(config.mode))
  addHighlight(
    highlights,
    t('message.block.runtime.sidecar'),
    stringValue(latestData.health) ?? stringValue(status.health) ?? stringValue(status.state)
  )

  const skillCount = numberValue(context.skillCount) ?? numberValue(latestData.skillCount)
  if (skillCount !== undefined) {
    addHighlight(highlights, t('message.block.runtime.skills'), String(skillCount))
  }

  const knowledgeCount = numberValue(context.knowledgeReferenceCount) ?? numberValue(latestData.knowledgeReferenceCount)
  if (knowledgeCount !== undefined) {
    addHighlight(highlights, t('message.block.runtime.knowledge'), String(knowledgeCount))
  }

  return highlights
}

function addHighlight(items: { label: string; value: string }[], label: string, value: string | undefined): void {
  if (value) {
    items.push({ label, value })
  }
}

function getReadableRuntimeError(data: Record<string, unknown>): string | undefined {
  const error = data.error
  if (typeof error === 'string') {
    return error
  }
  if (isRecord(error) && typeof error.message === 'string') {
    return error.message
  }
  if (typeof data.message === 'string') {
    return data.message
  }
  return undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 12px;
  padding: 10px 12px;
  border: 0.5px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-text);
`

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
`

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`

const RuntimeName = styled.span`
  font-weight: 600;
  font-size: 13px;
`

const SessionId = styled.span`
  min-width: 0;
  max-width: 220px;
  color: var(--color-text-2);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const LatestEvent = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
`

const EventTitle = styled.span`
  font-weight: 500;
`

const EventSummary = styled.span`
  color: var(--color-text-2);
  word-break: break-word;
`

const ApprovalRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding-top: 2px;
`

const HighlightRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`

const ErrorText = styled.div`
  color: var(--color-error);
  font-size: 13px;
  word-break: break-word;
`

const ApprovalLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-2);
  font-size: 12px;
`

const ApprovalActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`

const EventList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 0.5px solid var(--color-border);
  padding-top: 8px;
  font-size: 12px;
`

const EventRow = styled.div`
  display: flex;
  gap: 8px;
  color: var(--color-text-2);
  min-width: 0;

  span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const EventKind = styled.span`
  flex: 0 0 auto;
  color: var(--color-text);
  font-weight: 500;
`

const DebugDetails = styled.details`
  color: var(--color-text-2);
  font-size: 12px;

  summary {
    cursor: pointer;
    width: fit-content;
  }
`

const DebugPayload = styled.pre`
  max-height: 180px;
  overflow: auto;
  margin: 8px 0 0;
  padding: 8px;
  border-radius: 6px;
  background: var(--color-code-background);
  white-space: pre-wrap;
  word-break: break-word;
`

export default React.memo(RuntimeBlock)
