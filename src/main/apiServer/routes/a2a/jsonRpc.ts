import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import { MESSAGE_STREAM_TIMEOUT_MS } from '@main/apiServer/config/timeouts'
import {
  createStreamAbortController,
  STREAM_TIMEOUT_REASON,
  type StreamAbortController
} from '@main/apiServer/utils/createStreamAbortController'
import { sessionMessageService, sessionService } from '@main/services/agents'
import type { TextStreamPart } from 'ai'
import type { Request, Response } from 'express'

const logger = loggerService.withContext('A2AJsonRpc')

interface JsonRpcRequest {
  jsonrpc?: string
  method?: string
  params?: MessageSendParamsLoose
  id?: string | number | null
}

interface MessageSendParamsLoose {
  message?: unknown
  configuration?: unknown
  metadata?: {
    theBoss?: {
      agentId?: string
      sessionId?: string
    }
    [key: string]: unknown
  }
}

function jsonRpcError(id: string | number | null | undefined, code: number, message: string): object {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message }
  }
}

function extractUserTextFromMessage(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const m = message as {
    parts?: Array<{ kind?: string; text?: string; data?: unknown }>
  }
  if (!Array.isArray(m.parts)) return ''
  const texts: string[] = []
  for (const p of m.parts) {
    if (p.kind === 'text' && typeof p.text === 'string') texts.push(p.text)
  }
  return texts.join('\n')
}

/**
 * A2A JSON-RPC 2.0 over HTTP — subset: message/send (buffered) and message/stream (SSE).
 * Routes The Boss agent sessions via params.metadata.theBoss: { agentId, sessionId }.
 */
export async function handleA2AJsonRpc(req: Request, res: Response): Promise<void> {
  let streamController: StreamAbortController | undefined
  try {
    const body = req.body as JsonRpcRequest
    if (body.jsonrpc !== '2.0' || !body.method) {
      res.status(400).json(jsonRpcError(body.id ?? null, -32600, 'Invalid JSON-RPC request'))
      return
    }

    const method = body.method
    const params = body.params
    const id = body.id ?? null

    const agentId = params?.metadata?.theBoss?.agentId
    const sessionId = params?.metadata?.theBoss?.sessionId
    if (!agentId || !sessionId) {
      res.status(400).json(jsonRpcError(id, -32602, 'metadata.theBoss.agentId and sessionId are required'))
      return
    }

    const session = await sessionService.getSession(agentId, sessionId)
    if (!session || session.agent_id !== agentId) {
      res.status(404).json(jsonRpcError(id, -32001, 'Session not found'))
      return
    }

    const userText = extractUserTextFromMessage(params?.message)
    if (!userText.trim()) {
      res.status(400).json(jsonRpcError(id, -32602, 'User message text required in message.parts'))
      return
    }

    const messageData = { content: userText }

    if (method === 'message/send') {
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
        reader.releaseLock()
      }

      const text = (completedText + currentBlockText).replace(/\n+$/, '')

      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          message: {
            role: 'agent',
            parts: [{ kind: 'text', text }]
          }
        }
      })
      return
    }

    if (method === 'message/stream') {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      streamController = createStreamAbortController({ timeoutMs: MESSAGE_STREAM_TIMEOUT_MS })
      const { abortController, registerAbortHandler, dispose } = streamController

      const taskId = randomUUID()
      const contextId = randomUUID()
      const artifactId = randomUUID()

      const { stream, completion } = await sessionMessageService.createSessionMessage(
        session,
        messageData,
        abortController
      )
      const reader = stream.getReader()

      const writeRpc = (result: object) => {
        res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`)
      }

      writeRpc({
        id: taskId,
        contextId,
        status: { state: 'working' },
        kind: 'task'
      })

      registerAbortHandler((reason) => {
        dispose()
        if (reason === STREAM_TIMEOUT_REASON) {
          writeRpc({
            kind: 'status-update',
            taskId,
            contextId,
            status: { state: 'failed' },
            final: true
          } as unknown as object)
        }
        reader.cancel(reason ?? 'aborted').catch(() => {})
        res.end()
      })

      req.on('close', () => {
        if (!abortController.signal.aborted) abortController.abort('Client disconnected')
      })

      let completedText = ''
      let currentBlockText = ''

      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const part = value as TextStreamPart<any>
            const rawType = (part as { providerMetadata?: { raw?: { type?: string } } }).providerMetadata?.raw?.type
            if (rawType === 'user') continue

            if (part.type === 'text-delta' && part.text) {
              currentBlockText = part.text
              const full = completedText + currentBlockText
              writeRpc({
                kind: 'artifact-update',
                taskId,
                contextId,
                artifact: {
                  artifactId,
                  name: 'assistant_response',
                  parts: [{ kind: 'text', text: full }]
                },
                append: false,
                lastChunk: false
              } as unknown as object)
            } else if (part.type === 'text-end') {
              if (currentBlockText) {
                completedText += currentBlockText + '\n\n'
                currentBlockText = ''
              }
            }
          }

          await completion

          const finalText = (completedText + currentBlockText).replace(/\n+$/, '')
          writeRpc({
            kind: 'artifact-update',
            taskId,
            contextId,
            artifact: {
              artifactId,
              name: 'assistant_response',
              parts: [{ kind: 'text', text: finalText }]
            },
            append: false,
            lastChunk: true
          } as unknown as object)

          writeRpc({
            kind: 'status-update',
            taskId,
            contextId,
            status: { state: 'completed' },
            final: true
          } as unknown as object)

          dispose()
          res.end()
        } catch (e) {
          logger.error('A2A message/stream failed', { e })
          writeRpc({
            kind: 'status-update',
            taskId,
            contextId,
            status: { state: 'failed' },
            final: true
          } as unknown as object)
          dispose()
          res.end()
        }
      }

      pump().catch(() => {
        dispose()
        res.end()
      })
      return
    }

    res.status(400).json(jsonRpcError(id, -32601, `Method not found: ${method}`))
  } catch (error) {
    streamController?.dispose()
    logger.error('A2A handler error', { error })
    res
      .status(500)
      .json(
        jsonRpcError(
          (req.body as JsonRpcRequest)?.id ?? null,
          -32603,
          error instanceof Error ? error.message : 'Internal error'
        )
      )
  }
}
