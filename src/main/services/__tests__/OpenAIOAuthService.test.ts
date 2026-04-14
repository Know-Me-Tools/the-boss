import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  authFileExists: false,
  authFileContent: '{}',
  serverRunning: false,
  apiServerConfig: {
    host: '127.0.0.1',
    port: 23333,
    enabled: false,
    apiKey: 'public-api-key'
  },
  fetchResponse: null as null | { ok: boolean; status?: number; json: () => Promise<unknown> }
}))

const mockCreateOpenAIOAuthFetchHandler = vi.fn()
const mockReadAuthFile = vi.fn()
const mockApiServerStart = vi.fn(async () => {
  mockState.serverRunning = true
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('openai-oauth', () => ({
  createOpenAIOAuthFetchHandler: (...args: unknown[]) => mockCreateOpenAIOAuthFetchHandler(...args)
}))

vi.mock('../ApiServerService', () => ({
  apiServerService: {
    isRunning: () => mockState.serverRunning,
    start: mockApiServerStart
  }
}))

vi.mock('../../apiServer/config', () => ({
  config: {
    get: async () => mockState.apiServerConfig
  }
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: (filePath: string) => {
      if (filePath === '/mock/codex/auth.json') {
        return mockState.authFileExists
      }
      if (filePath.endsWith('/.codex/auth.json')) {
        return false
      }
      return false
    },
    promises: {
      readFile: mockReadAuthFile
    }
  }
}))

vi.mock('node:os', () => ({
  default: {
    homedir: () => '/mock/home'
  }
}))

describe('OpenAIOAuthService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockState.authFileExists = false
    mockState.authFileContent = '{}'
    mockState.serverRunning = false
    mockState.apiServerConfig = {
      host: '127.0.0.1',
      port: 23333,
      enabled: false,
      apiKey: 'public-api-key'
    }
    mockState.fetchResponse = null
    mockReadAuthFile.mockImplementation(async () => mockState.authFileContent)
    mockCreateOpenAIOAuthFetchHandler.mockReturnValue(async (request: Request) =>
      new Response(JSON.stringify({ ok: true, path: new URL(request.url).pathname }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubEnv('CODEX_HOME', '/mock/codex')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (!mockState.fetchResponse) {
          throw new Error('connect ECONNREFUSED')
        }
        return mockState.fetchResponse
      })
    )
  })

  it('reports missing file-backed Codex credentials', async () => {
    const { openAIOAuthService } = await import('../OpenAIOAuthService')

    const status = await openAIOAuthService.getStatus()

    expect(status.installState).toBe('installed')
    expect(status.credentialStatus.state).toBe('missing')
    expect(status.credentialStatus.authFilePath).toBeNull()
    expect(status.healthState).toBe('unhealthy')
  })

  it('reports unsupported keychain-backed credentials when auth.json lacks reusable tokens', async () => {
    mockState.authFileExists = true
    mockState.authFileContent = JSON.stringify({ credentialStore: 'keychain' })

    const { openAIOAuthService } = await import('../OpenAIOAuthService')

    const status = await openAIOAuthService.getStatus()

    expect(status.credentialStatus.state).toBe('unsupported')
    expect(status.credentialStatus.authFilePath).toBe('/mock/codex/auth.json')
  })

  it('parses healthy internal endpoint model responses', async () => {
    mockState.authFileExists = true
    mockState.serverRunning = true
    mockState.authFileContent = JSON.stringify({ access_token: 'token', refresh_token: 'refresh' })
    mockState.fetchResponse = {
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-5.4' }, { id: 'gpt-5.3-codex' }] })
    }

    const { openAIOAuthService } = await import('../OpenAIOAuthService')

    const health = await openAIOAuthService.checkHealth()
    const status = await openAIOAuthService.getStatus()

    expect(health).toEqual({ status: 'healthy', models: ['gpt-5.4', 'gpt-5.3-codex'] })
    expect(status.healthState).toBe('healthy')
    expect(status.availableModels).toEqual(['gpt-5.4', 'gpt-5.3-codex'])
    expect(status.credentialStatus.state).toBe('valid')
  })

  it('starts the API server and activates the internal endpoint', async () => {
    mockState.authFileExists = true
    mockState.authFileContent = JSON.stringify({ access_token: 'token', refresh_token: 'refresh' })
    mockState.fetchResponse = {
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-5.4' }] })
    }

    const { openAIOAuthService } = await import('../OpenAIOAuthService')

    const result = await openAIOAuthService.startProxy()

    expect(result).toEqual({ success: true })
    expect(mockApiServerStart).toHaveBeenCalledTimes(1)
    expect(await openAIOAuthService.getBaseUrl()).toBe('http://127.0.0.1:23333/_internal/openai-oauth/v1')
    expect(await openAIOAuthService.getModels()).toEqual(['gpt-5.4'])
  })

  it('returns an internal header and normalizes wildcard API server hosts to loopback', async () => {
    mockState.authFileExists = true
    mockState.apiServerConfig.host = '0.0.0.0'

    const { openAIOAuthService } = await import('../OpenAIOAuthService')

    expect(await openAIOAuthService.getBaseUrl()).toBe('http://127.0.0.1:23333/_internal/openai-oauth/v1')
    expect(await openAIOAuthService.getRequestHeaders()).toHaveProperty('x-cherry-openai-oauth-secret')
  })

  it('forwards internal requests through the in-process openai-oauth handler', async () => {
    mockState.authFileExists = true
    mockState.authFileContent = JSON.stringify({ access_token: 'token', refresh_token: 'refresh' })
    const internalHandler = vi.fn(async (request: Request) =>
      new Response(JSON.stringify({ ok: true, path: new URL(request.url).pathname }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    mockCreateOpenAIOAuthFetchHandler.mockReturnValue(internalHandler)

    const { openAIOAuthService } = await import('../OpenAIOAuthService')

    const response = await openAIOAuthService.handleInternalRequest(new Request('http://internal/v1/models'))

    expect(mockCreateOpenAIOAuthFetchHandler).toHaveBeenCalledWith(
      expect.objectContaining({ authFilePath: '/mock/codex/auth.json' })
    )
    expect(internalHandler).toHaveBeenCalledTimes(1)
    await expect(response.json()).resolves.toEqual({ ok: true, path: '/v1/models' })
  })
})
