import { loggerService } from '@logger'
import { MESSAGE_STREAM_TIMEOUT_MS } from '@main/apiServer/config/timeouts'
import {
  agUiRunError,
  agUiRunFinished,
  createAgUiMapperState,
  mapTextStreamPartToAgUiEvents
} from '@main/apiServer/protocols/agUiMapper'
import {
  createStreamAbortController,
  STREAM_TIMEOUT_REASON,
  type StreamAbortController
} from '@main/apiServer/utils/createStreamAbortController'
import { agentService, sessionMessageService, sessionService } from '@main/services/agents'
import type { Request, Response } from 'express'

const logger = loggerService.withContext('ApiServerMessagesAgUi')

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
 * SSE stream of AG-UI protocol events (see docs.ag-ui.com) for the agent session message pipeline.
 */
export const createAgUiMessage = async (req: Request, res: Response): Promise<void> => {
  let streamController: StreamAbortController | undefined

  try {
    const { agentId, sessionId } = req.params
    const session = await verifyAgentAndSession(agentId, sessionId)
    const messageData = req.body

    logger.info('Creating AG-UI streaming message', { agentId, sessionId })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-AG-UI-Protocol', 'docs.ag-ui.com')
    res.setHeader('Access-Control-Allow-Origin', '*')

    streamController = createStreamAbortController({
      timeoutMs: MESSAGE_STREAM_TIMEOUT_MS
    })
    const { abortController, registerAbortHandler, dispose } = streamController
    const { stream, completion } = await sessionMessageService.createSessionMessage(
      session,
      messageData,
      abortController
    )
    const reader = stream.getReader()
    const agState = createAgUiMapperState(sessionId)

    let responseEnded = false
    let streamFinished = false

    const cleanup = () => {
      dispose()
    }

    const finalizeResponse = () => {
      if (responseEnded) return
      if (!streamFinished) return
      responseEnded = true
      cleanup()
      try {
        res.write('data: [DONE]\n\n')
      } catch (writeError) {
        logger.error('Error writing AG-UI final sentinel', { error: writeError as Error })
      }
      res.end()
    }

    const writeAgUi = (obj: object) => {
      if (responseEnded) return
      res.write(`data: ${JSON.stringify(obj)}\n\n`)
    }

    registerAbortHandler((abortReason) => {
      cleanup()
      if (responseEnded) return
      responseEnded = true
      if (abortReason === STREAM_TIMEOUT_REASON) {
        writeAgUi(agUiRunError('Stream timeout'))
      }
      reader.cancel(abortReason ?? 'stream aborted').catch(() => {})
      if (!res.writableEnded) res.end()
    })

    const handleDisconnect = () => {
      if (abortController.signal.aborted) return
      abortController.abort('Client disconnected')
    }

    req.on('close', handleDisconnect)
    req.on('aborted', handleDisconnect)
    res.on('close', handleDisconnect)

    const pumpStream = async () => {
      try {
        while (!responseEnded) {
          const { done, value } = await reader.read()
          if (done) break
          const events = mapTextStreamPartToAgUiEvents(agState, value)
          for (const ev of events) {
            writeAgUi(ev)
          }
        }

        await completion
        for (const ev of agUiRunFinished(agState)) {
          writeAgUi(ev)
        }
        streamFinished = true
        finalizeResponse()
      } catch (error) {
        if (responseEnded) return
        logger.error('AG-UI stream error', { error })
        writeAgUi(agUiRunError(error instanceof Error ? error.message : String(error)))
        responseEnded = true
        cleanup()
        res.end()
      }
    }

    pumpStream().catch((error) => {
      logger.error('AG-UI pump failure', { error })
    })

    res.on('close', cleanup)
    res.on('finish', cleanup)
  } catch (error: unknown) {
    streamController?.dispose()
    logger.error('AG-UI handler failed', { error })
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream')
    }
    try {
      res.write(
        `data: ${JSON.stringify(agUiRunError((error as Error)?.message || 'Failed to start AG-UI stream'))}\n\n`
      )
    } catch {
      // ignore
    }
    res.end()
  }
}
