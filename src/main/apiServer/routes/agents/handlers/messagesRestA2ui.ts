import { loggerService } from '@logger'
import { tryExtractA2uiFromAssistantText } from '@main/apiServer/protocols/a2uiValidation'
import { agentService, sessionMessageService, sessionService } from '@main/services/agents'
import type { TextStreamPart } from 'ai'
import type { Request, Response } from 'express'

const logger = loggerService.withContext('ApiServerMessagesRestA2ui')

const verifyAgentAndSession = async (agentId: string, sessionId: string) => {
  const agentExists = await agentService.agentExists(agentId)
  if (!agentExists) {
    throw { status: 404, code: 'agent_not_found', message: 'Agent not found' }
  }
  const session = await sessionService.getSession(agentId, sessionId)
  if (!session) {
    throw { status: 404, code: 'session_not_found', message: 'Session not found' }
  }
  if (session.agent_id !== agentId) {
    throw { status: 404, code: 'session_not_found', message: 'Session not found for this agent' }
  }
  return session
}

/**
 * Non-streaming JSON response: `{ text, a2ui }` where `a2ui` is set only when the
 * assistant output contains valid JSON matching minimal A2UI root validation.
 */
export const createBufferedMessageWithA2ui = async (req: Request, res: Response): Promise<void> => {
  try {
    const { agentId, sessionId } = req.params
    const session = await verifyAgentAndSession(agentId, sessionId)
    const messageData = req.body

    const abortController = new AbortController()
    const { stream, completion } = await sessionMessageService.createSessionMessage(
      session,
      messageData,
      abortController
    )

    const reader = stream.getReader()
    let completedText = ''
    let currentBlockText = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const part = value as TextStreamPart<any>
        const rawType = (part as { providerMetadata?: { raw?: { type?: string } } }).providerMetadata?.raw?.type
        if (rawType === 'user') continue

        switch (part.type) {
          case 'text-delta':
            if (part.text) currentBlockText = part.text
            break
          case 'text-end':
            if (currentBlockText) {
              completedText += currentBlockText + '\n\n'
              currentBlockText = ''
            }
            break
          default:
            break
        }
      }
      await completion
    } finally {
      reader.releaseLock?.()
    }

    const text = (completedText + currentBlockText).replace(/\n+$/, '')
    const a2uiResult = tryExtractA2uiFromAssistantText(text)

    res.json({
      text,
      a2ui: a2uiResult?.ok ? a2uiResult.value : null,
      protocols: {
        a2uiSchema: 'minimal-validation',
        note: 'a2ui is only set when assistant output parses as JSON with a non-empty type field'
      }
    })
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string; code?: string }
    logger.error('Buffered A2UI message failed', { error })
    const status = err.status ?? 500
    res.status(status).json({
      error: {
        message: err.message || 'Failed to create buffered message',
        code: err.code ?? 'buffered_message_failed',
        type: status === 404 ? 'not_found' : 'internal_error'
      }
    })
  }
}
