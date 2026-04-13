import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  sidecarManifestExists: true,
  sidecarCliExists: true,
  authFileExists: false,
  authFileContent: '{}',
  oauthPort: 10531,
  fetchResponse: null as null | { ok: boolean; status?: number; json: () => Promise<unknown> },
  fetchResponses: [] as Array<null | { ok: boolean; status?: number; json: () => Promise<unknown> }>
}))

const mockReadAuthFile = vi.fn()
const mockSpawn = vi.fn()
const mockExecFileSync = vi.fn()

function createMockChildProcess() {
  const stdoutHandlers = new Map<string, Array<(chunk: Buffer) => void>>()
  const stderrHandlers = new Map<string, Array<(chunk: Buffer) => void>>()
  const processHandlers = new Map<string, Array<(...args: any[]) => void>>()

  const stdout = {
    on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
      const handlers = stdoutHandlers.get(event) ?? []
      handlers.push(handler)
      stdoutHandlers.set(event, handlers)
      return stdout
    })
  }

  const stderr = {
    on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
      const handlers = stderrHandlers.get(event) ?? []
      handlers.push(handler)
      stderrHandlers.set(event, handlers)
      return stderr
    })
  }

  const childProcess = {
    pid: 4242,
    killed: false,
    stdout,
    stderr,
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      const handlers = processHandlers.get(event) ?? []
      handlers.push(handler)
      processHandlers.set(event, handlers)
      return childProcess
    }),
    unref: vi.fn(),
    emitStdout: (message: string) => {
      for (const handler of stdoutHandlers.get('data') ?? []) {
        handler(Buffer.from(message))
      }
    },
    emitStderr: (message: string) => {
      for (const handler of stderrHandlers.get('data') ?? []) {
        handler(Buffer.from(message))
      }
    },
    emitProcessEvent: (event: string, ...args: any[]) => {
      for (const handler of processHandlers.get(event) ?? []) {
        handler(...args)
      }
    }
  }

  return childProcess
}

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

vi.mock('node:child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  execFileSync: (...args: any[]) => mockExecFileSync(...args)
}))

vi.mock('@main/constant', () => ({
  isWin: false
}))

vi.mock('../ConfigManager', () => ({
  ConfigKeys: {
    OpenAIOAuthPort: 'openAIOAuthPort'
  },
  configManager: {
    get: vi.fn((key: string, defaultValue?: unknown) => {
      if (key === 'openAIOAuthPort') {
        return mockState.oauthPort
      }
      return defaultValue
    })
  }
}))

vi.mock('../utils', () => ({
  toAsarUnpackedPath: (filePath: string) => filePath
}))

vi.mock('node:module', () => ({
  createRequire: () => ({
    resolve: (specifier: string) => {
      if (specifier === 'openai-oauth') {
        return '/mock/node_modules/openai-oauth/dist/index.js'
      }
      throw new Error(`Unexpected specifier: ${specifier}`)
    }
  })
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: (filePath: string) => {
      if (filePath === '/mock/node_modules/openai-oauth/package.json') return mockState.sidecarManifestExists
      if (filePath === '/mock/node_modules/openai-oauth/dist/cli.js') return mockState.sidecarCliExists
      if (filePath === '/mock/codex/auth.json') return mockState.authFileExists
      if (filePath.endsWith('/.codex/auth.json')) return false
      return false
    },
    readFileSync: (filePath: string) => {
      if (filePath === '/mock/node_modules/openai-oauth/package.json') {
        return JSON.stringify({ bin: { 'openai-oauth': 'dist/cli.js' } })
      }
      throw new Error(`Unexpected readFileSync: ${filePath}`)
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
    mockState.sidecarManifestExists = true
    mockState.sidecarCliExists = true
    mockState.authFileExists = false
    mockState.authFileContent = '{}'
    mockState.oauthPort = 10531
    mockState.fetchResponse = null
    mockState.fetchResponses = []
    mockReadAuthFile.mockImplementation(async () => mockState.authFileContent)
    mockSpawn.mockReset()
    mockExecFileSync.mockReset()
    vi.stubEnv('CODEX_HOME', '/mock/codex')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const nextResponse =
          mockState.fetchResponses.length > 0 ? mockState.fetchResponses.shift() ?? null : mockState.fetchResponse

        if (!nextResponse) {
          throw new Error('connect ECONNREFUSED')
        }
        return nextResponse
      })
    )
    vi.useRealTimers()
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

  it('parses healthy proxy model responses', async () => {
    mockState.authFileExists = true
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

  it('fails to start when the bundled sidecar is unavailable', async () => {
    mockState.sidecarManifestExists = false
    mockState.sidecarCliExists = false

    const { openAIOAuthService } = await import('../OpenAIOAuthService')

    const result = await openAIOAuthService.startProxy()

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('Expected startProxy to fail when the bundled sidecar is unavailable')
    }
    expect(result.message).toContain('bundled openai-oauth sidecar is unavailable')
  })

  it('fails to start when Codex OAuth credentials are missing', async () => {
    const { openAIOAuthService } = await import('../OpenAIOAuthService')

    const result = await openAIOAuthService.startProxy()

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('Expected startProxy to fail when credentials are missing')
    }
    expect(result.message).toContain('No file-backed Codex OAuth cache was found')
  })

  it('starts the OpenAI OAuth proxy and becomes healthy', async () => {
    vi.useFakeTimers()

    const childProcess = createMockChildProcess()
    mockSpawn.mockReturnValue(childProcess)
    mockState.authFileExists = true
    mockState.authFileContent = JSON.stringify({ access_token: 'token', refresh_token: 'refresh' })
    mockState.fetchResponses = [
      null,
      {
        ok: true,
        json: async () => ({ data: [{ id: 'gpt-5.4' }, { id: 'gpt-5.3-codex' }] })
      },
      {
        ok: true,
        json: async () => ({ data: [{ id: 'gpt-5.4' }, { id: 'gpt-5.3-codex' }] })
      },
      {
        ok: true,
        json: async () => ({ data: [{ id: 'gpt-5.4' }, { id: 'gpt-5.3-codex' }] })
      }
    ]

    const { openAIOAuthService } = await import('../OpenAIOAuthService')

    const startPromise = openAIOAuthService.startProxy()
    await vi.advanceTimersByTimeAsync(750)
    const result = await startPromise

    expect(result).toEqual({ success: true })
    expect(mockSpawn).toHaveBeenCalledTimes(1)
    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      [
        '/mock/node_modules/openai-oauth/dist/cli.js',
        '--host',
        '127.0.0.1',
        '--port',
        '10531',
        '--oauth-file',
        '/mock/codex/auth.json'
      ],
      expect.objectContaining({
        detached: true,
        windowsHide: true,
        env: expect.objectContaining({
          CODEX_HOME: '/mock/codex',
          ELECTRON_RUN_AS_NODE: '1'
        }),
        stdio: ['ignore', 'pipe', 'pipe']
      })
    )
    expect(childProcess.unref).toHaveBeenCalled()
    expect(await openAIOAuthService.getBaseUrl()).toBe('http://127.0.0.1:10531/v1')
    expect(await openAIOAuthService.getModels()).toEqual(['gpt-5.4', 'gpt-5.3-codex'])

    const status = await openAIOAuthService.getStatus()
    expect(status.runState).toBe('running')
    expect(status.healthState).toBe('healthy')
    expect(status.availableModels).toEqual(['gpt-5.4', 'gpt-5.3-codex'])
  })

  it('does not spawn a new process when the proxy is already healthy', async () => {
    mockState.authFileExists = true
    mockState.authFileContent = JSON.stringify({ access_token: 'token', refresh_token: 'refresh' })
    mockState.fetchResponse = {
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-5.4' }] })
    }

    const { openAIOAuthService } = await import('../OpenAIOAuthService')

    const result = await openAIOAuthService.startProxy()

    expect(result).toEqual({ success: true })
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('uses the configured sidecar port for startup and base URL reporting', async () => {
    vi.useFakeTimers()

    const childProcess = createMockChildProcess()
    mockSpawn.mockReturnValue(childProcess)
    mockState.oauthPort = 11555
    mockState.authFileExists = true
    mockState.authFileContent = JSON.stringify({ access_token: 'token', refresh_token: 'refresh' })
    mockState.fetchResponses = [
      null,
      {
        ok: true,
        json: async () => ({ data: [{ id: 'gpt-5.4' }] })
      }
    ]

    const { openAIOAuthService } = await import('../OpenAIOAuthService')

    const startPromise = openAIOAuthService.startProxy()
    await vi.advanceTimersByTimeAsync(750)
    const result = await startPromise

    expect(result).toEqual({ success: true })
    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['--port', '11555']),
      expect.any(Object)
    )
    expect(await openAIOAuthService.getBaseUrl()).toBe('http://127.0.0.1:11555/v1')
  })
})
