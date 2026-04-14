import { createRequire } from 'node:module'
import path from 'node:path'

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import anthropicService from '@main/services/AnthropicService'
import { loggerService } from '@main/services/LoggerService'
import { toAsarUnpackedPath } from '@main/utils'
import { app } from 'electron'
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import express from 'express'

const require_ = createRequire(import.meta.url)
const logger = loggerService.withContext('ApiServerInternalAnthropicOAuthRoutes')

const router = express.Router()

function getClaudeExecutablePath(): string {
  return toAsarUnpackedPath(
    path.join(path.dirname(require_.resolve('@anthropic-ai/claude-agent-sdk')), 'cli.js')
  )
}

/**
 * Extract a plain text prompt from an Anthropic-format messages array.
 * We take the last user message and convert it to a string.
 */
function extractPrompt(messages: any[]): string {
  const lastUser = [...messages].reverse().find((m: any) => m.role === 'user')
  if (!lastUser) return ''
  const { content } = lastUser
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text as string)
      .join('\n')
  }
  return ''
}

function writeSseEvent(res: ExpressResponse, event: Record<string, unknown>) {
  res.write(`event: ${event.type}\n`)
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

async function handleMessagesRequest(req: ExpressRequest, res: ExpressResponse) {
  try {
    const oauthToken = await anthropicService.getValidAccessToken()
    if (!oauthToken) {
      res.status(401).json({
        error: {
          message: 'Anthropic OAuth credentials are not configured.',
          type: 'authentication_error',
          code: 'missing_oauth_credentials'
        }
      })
      return
    }

    const { messages = [], model, system, stream: wantsStream } = req.body as {
      messages?: any[]
      model?: string
      system?: string
      stream?: boolean
    }

    const prompt = extractPrompt(messages)
    if (!prompt) {
      res.status(400).json({
        error: {
          message: 'No user message found in request body.',
          type: 'invalid_request_error',
          code: 'missing_user_message'
        }
      })
      return
    }

    const sdkQuery = query({
      prompt,
      options: {
        model: model ?? 'claude-opus-4-6',
        systemPrompt: system,
        maxTurns: 1,
        // No tools — this is a pure chat completion
        tools: [],
        allowedTools: [],
        // Emit raw Anthropic SSE events so we can forward them directly
        includePartialMessages: true,
        // Ephemeral: don't persist session history to ~/.claude/projects/
        persistSession: false,
        permissionMode: 'dontAsk',
        pathToClaudeCodeExecutable: getClaudeExecutablePath(),
        env: {
          ...process.env,
          // Empty API key forces Claude Code SDK to use Bearer auth via ANTHROPIC_AUTH_TOKEN
          ANTHROPIC_API_KEY: '',
          ANTHROPIC_AUTH_TOKEN: oauthToken,
          ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
          CLAUDE_CODE_USE_BEDROCK: '0',
          CLAUDE_CONFIG_DIR: path.join(app.getPath('userData'), '.claude')
        }
      }
    })

    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      for await (const message of sdkQuery as AsyncIterable<SDKMessage>) {
        if (message.type === 'stream_event') {
          // SDKPartialAssistantMessage: event.event is a raw BetaRawMessageStreamEvent —
          // forward it directly as an SSE event; no translation needed.
          writeSseEvent(res, message.event as unknown as Record<string, unknown>)
        } else if (message.type === 'assistant' && message.error) {
          writeSseEvent(res, {
            type: 'error',
            error: { type: 'api_error', message: message.error }
          })
        }
      }

      res.end()
    } else {
      // Non-streaming: accumulate text from assistant messages
      let text = ''
      let inputTokens = 0
      let outputTokens = 0

      for await (const message of sdkQuery as AsyncIterable<SDKMessage>) {
        if (message.type === 'assistant') {
          for (const block of message.message?.content ?? []) {
            if (block.type === 'text') {
              text += block.text
            }
          }
        } else if (message.type === 'result' && message.subtype === 'success') {
          inputTokens = (message as any).usage?.input_tokens ?? 0
          outputTokens = (message as any).usage?.output_tokens ?? 0
        }
      }

      res.json({
        id: `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text }],
        model: model ?? 'claude-opus-4-6',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens }
      })
    }
  } catch (error) {
    logger.error('Failed to handle Anthropic OAuth request via Claude Code SDK', error as Error)
    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Internal Anthropic OAuth proxy failed.',
          type: 'server_error',
          code: 'internal_oauth_proxy_error'
        }
      })
    }
  }
}

router.get('/v1/models', (_req, res) => {
  // OAuth via Claude Max — return the models available on that subscription
  res.json({
    data: [
      { id: 'claude-opus-4-6', object: 'model', created: 0, owned_by: 'anthropic' },
      { id: 'claude-sonnet-4-6', object: 'model', created: 0, owned_by: 'anthropic' },
      { id: 'claude-haiku-4-5-20251001', object: 'model', created: 0, owned_by: 'anthropic' }
    ]
  })
})

router.post('/v1/messages', async (req, res) => {
  await handleMessagesRequest(req, res)
})

export { router as anthropicOAuthInternalRoutes }
