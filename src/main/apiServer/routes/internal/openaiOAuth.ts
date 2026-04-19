import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

import { loggerService } from '@main/services/LoggerService'
import { openAIOAuthService } from '@main/services/OpenAIOAuthService'
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import express from 'express'
import { defaultOpenAIOAuthModels } from 'openai-oauth'

const logger = loggerService.withContext('ApiServerInternalOpenAIOAuthRoutes')

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade'
])

const router = express.Router()

// Headers that must NOT be forwarded to the internal OpenAI OAuth handler
const REQUEST_HEADERS_TO_STRIP = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'x-cherry-openai-oauth-secret',
  'x-cherry-anthropic-oauth-secret'
])

async function forwardInternalRequest(req: ExpressRequest, res: ExpressResponse) {
  try {
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'undefined') {
        continue
      }

      if (REQUEST_HEADERS_TO_STRIP.has(key.toLowerCase())) {
        continue
      }

      if (Array.isArray(value)) {
        for (const entry of value) {
          headers.append(key, entry)
        }
        continue
      }

      headers.set(key, value)
    }

    let body: string | undefined
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = req.body ? JSON.stringify(req.body) : undefined
      if (body && !headers.has('content-type')) {
        headers.set('content-type', 'application/json')
      }
    }

    const requestInit: RequestInit & { duplex?: 'half' } = {
      method: req.method,
      headers,
      body
    }

    if (body) {
      requestInit.duplex = 'half'
    }

    const model = req.body?.model ?? 'unknown'
    logger.debug('Forwarding OpenAI OAuth request', { url: req.url, model })

    const request = new Request(`http://internal${req.url}`, requestInit)

    const upstreamResponse = await openAIOAuthService.handleInternalRequest(request)

    logger.debug('OpenAI OAuth upstream response', { status: upstreamResponse.status, model })

    if (!upstreamResponse.ok && upstreamResponse.status !== 200) {
      const errorBody = await upstreamResponse.text()
      logger.error('OpenAI OAuth upstream returned non-OK status', {
        status: upstreamResponse.status,
        model,
        body: errorBody.slice(0, 500)
      })
      if (!res.headersSent) {
        res.status(upstreamResponse.status).send(errorBody)
      }
      return
    }

    await writeFetchResponse(res, upstreamResponse)
  } catch (error) {
    logger.error('Failed to proxy internal OpenAI OAuth request', { error: error as Error })
    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Internal OpenAI OAuth proxy failed.',
          type: 'server_error',
          code: 'internal_oauth_proxy_error'
        }
      })
    } else if (!res.writableEnded) {
      res.end()
    }
  }
}

async function writeFetchResponse(res: ExpressResponse, response: Response) {
  for (const [key, value] of response.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      res.setHeader(key, value)
    }
  }

  res.status(response.status)

  if (!response.body) {
    res.end()
    return
  }

  const bodyStream = Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>)

  await new Promise<void>((resolve, reject) => {
    const safeEnd = () => {
      if (!res.writableEnded) {
        res.end()
      }
    }

    bodyStream.on('error', (err) => {
      logger.error('OpenAI OAuth upstream stream error', { error: err })
      // Always end the response to avoid ERR_INCOMPLETE_CHUNKED_ENCODING on the client
      safeEnd()
      reject(err)
    })

    res.on('error', (err) => {
      logger.error('Response write error during OpenAI OAuth streaming', { error: err })
      bodyStream.destroy()
      reject(err)
    })

    res.on('close', resolve)
    res.on('finish', resolve)

    bodyStream.pipe(res)
  })
}

router.get('/v1/models', (_req, res) => {
  const now = Math.floor(Date.now() / 1000)
  const models = defaultOpenAIOAuthModels.map((id) => ({
    id,
    object: 'model',
    created: now,
    owned_by: 'openai'
  }))
  res.json({ object: 'list', data: models })
})

router.post('/v1/chat/completions', async (req, res) => {
  await forwardInternalRequest(req, res)
})

export { router as openAIOAuthInternalRoutes }
