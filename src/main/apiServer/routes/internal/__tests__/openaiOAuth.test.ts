import { createServer, type Server } from 'node:http'

import express from 'express'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockMatchesInternalSecret = vi.hoisted(() => vi.fn())
const mockHandleInternalRequest = vi.hoisted(() => vi.fn())
const INTERNAL_HEADER = 'x-cherry-openai-oauth-secret'

vi.mock('@main/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@main/services/OpenAIOAuthService', () => ({
  openAIOAuthService: {
    getInternalHeaderName: () => INTERNAL_HEADER,
    matchesInternalSecret: (...args: unknown[]) => mockMatchesInternalSecret(...args),
    handleInternalRequest: (...args: unknown[]) => mockHandleInternalRequest(...args)
  }
}))

import { openAIOAuthInternalAuthMiddleware } from '../../../middleware/openaiOAuthInternalAuth'
import { openAIOAuthInternalRoutes } from '../openaiOAuth'

async function startTestServer(options?: { forceRemoteAddress?: string }) {
  const app = express()
  app.use(express.json())

  if (options?.forceRemoteAddress) {
    app.use((req, _res, next) => {
      Object.defineProperty(req.socket, 'remoteAddress', {
        configurable: true,
        value: options.forceRemoteAddress
      })
      next()
    })
  }

  app.use('/_internal/openai-oauth', openAIOAuthInternalAuthMiddleware, openAIOAuthInternalRoutes)

  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start test server')
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  }
}

describe('openAIOAuthInternalRoutes', () => {
  const servers: Server[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    mockMatchesInternalSecret.mockReturnValue(true)
    mockHandleInternalRequest.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'gpt-5.4' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  })

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
    servers.length = 0
  })

  it('accepts loopback requests with the internal secret header', async () => {
    const { server, baseUrl } = await startTestServer()
    servers.push(server)

    const response = await fetch(`${baseUrl}/_internal/openai-oauth/v1/models`, {
      headers: { [INTERNAL_HEADER]: 'internal-secret' }
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: [{ id: 'gpt-5.4' }] })
    expect(mockHandleInternalRequest).toHaveBeenCalledTimes(1)
  })

  it('rejects requests missing the internal secret header', async () => {
    const { server, baseUrl } = await startTestServer()
    servers.push(server)

    const response = await fetch(`${baseUrl}/_internal/openai-oauth/v1/models`)

    expect(response.status).toBe(401)
    expect(mockHandleInternalRequest).not.toHaveBeenCalled()
  })

  it('rejects requests that only provide the public API key headers', async () => {
    const { server, baseUrl } = await startTestServer()
    servers.push(server)

    const response = await fetch(`${baseUrl}/_internal/openai-oauth/v1/models`, {
      headers: {
        Authorization: 'Bearer public-api-key',
        'X-Api-Key': 'public-api-key'
      }
    })

    expect(response.status).toBe(401)
    expect(mockHandleInternalRequest).not.toHaveBeenCalled()
  })

  it('rejects non-loopback requests even with the internal secret header', async () => {
    const { server, baseUrl } = await startTestServer({ forceRemoteAddress: '10.0.0.2' })
    servers.push(server)

    const response = await fetch(`${baseUrl}/_internal/openai-oauth/v1/models`, {
      headers: { [INTERNAL_HEADER]: 'internal-secret' }
    })

    expect(response.status).toBe(403)
    expect(mockHandleInternalRequest).not.toHaveBeenCalled()
  })

  it('streams chat completion responses through the internal route', async () => {
    mockHandleInternalRequest.mockResolvedValue(
      new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"id":"chunk-1"}\n\n'))
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          controller.close()
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      })
    )

    const { server, baseUrl } = await startTestServer()
    servers.push(server)

    const response = await fetch(`${baseUrl}/_internal/openai-oauth/v1/chat/completions`, {
      method: 'POST',
      headers: {
        [INTERNAL_HEADER]: 'internal-secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: 'gpt-5.4', stream: true, messages: [{ role: 'user', content: 'hello' }] })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    await expect(response.text()).resolves.toContain('data: {"id":"chunk-1"}')
  })
})
