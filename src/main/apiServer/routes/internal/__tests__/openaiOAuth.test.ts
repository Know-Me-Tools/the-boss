import { createServer, type Server } from 'node:http'

import express from 'express'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockHandleInternalRequest = vi.hoisted(() => vi.fn())

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
    handleInternalRequest: (...args: unknown[]) => mockHandleInternalRequest(...args)
  }
}))

vi.mock('../../../config', () => ({
  config: {
    get: () => Promise.resolve({ apiKey: 'test-api-key' })
  }
}))

import { authMiddleware } from '../../../middleware/auth'
import { openAIOAuthInternalRoutes } from '../openaiOAuth'

async function startTestServer() {
  const app = express()
  app.use(express.json())
  app.use('/_internal/openai-oauth', authMiddleware, openAIOAuthInternalRoutes)

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

  it('accepts requests with the API key as a Bearer token', async () => {
    const { server, baseUrl } = await startTestServer()
    servers.push(server)

    const response = await fetch(`${baseUrl}/_internal/openai-oauth/v1/models`, {
      headers: { Authorization: 'Bearer test-api-key' }
    })

    expect(response.status).toBe(200)
    expect(mockHandleInternalRequest).not.toHaveBeenCalled()
  })

  it('rejects requests missing the Authorization header', async () => {
    const { server, baseUrl } = await startTestServer()
    servers.push(server)

    const response = await fetch(`${baseUrl}/_internal/openai-oauth/v1/models`)

    expect(response.status).toBe(401)
    expect(mockHandleInternalRequest).not.toHaveBeenCalled()
  })

  it('rejects requests with an invalid API key', async () => {
    const { server, baseUrl } = await startTestServer()
    servers.push(server)

    const response = await fetch(`${baseUrl}/_internal/openai-oauth/v1/models`, {
      headers: { Authorization: 'Bearer wrong-key' }
    })

    expect(response.status).toBe(403)
    expect(mockHandleInternalRequest).not.toHaveBeenCalled()
  })

  it('streams chat completion responses through the internal route', async () => {
    mockHandleInternalRequest.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"id":"chunk-1"}\n\n'))
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
            controller.close()
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        }
      )
    )

    const { server, baseUrl } = await startTestServer()
    servers.push(server)

    const response = await fetch(`${baseUrl}/_internal/openai-oauth/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-api-key',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: 'gpt-5.4', stream: true, messages: [{ role: 'user', content: 'hello' }] })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    await expect(response.text()).resolves.toContain('data: {"id":"chunk-1"}')
  })
})
