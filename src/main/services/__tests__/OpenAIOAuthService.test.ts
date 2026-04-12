import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  authFileExists: false,
  authFileContent: '{}',
  fetchResponse: null as null | { ok: boolean; status?: number; json: () => Promise<unknown> }
}))

const mockReadAuthFile = vi.fn()

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

vi.mock('@main/constant', () => ({
  isWin: false
}))

vi.mock('../utils', () => ({
  toAsarUnpackedPath: (filePath: string) => filePath
}))

vi.mock('node:module', () => ({
  createRequire: () => ({
    resolve: (specifier: string) => {
      if (specifier === 'openai-oauth/package.json') {
        return '/mock/node_modules/openai-oauth/package.json'
      }
      throw new Error(`Unexpected specifier: ${specifier}`)
    }
  })
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: (filePath: string) => {
      if (filePath === '/mock/node_modules/openai-oauth/package.json') return true
      if (filePath === '/mock/node_modules/openai-oauth/dist/cli.js') return true
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
    vi.clearAllMocks()
    mockState.authFileExists = false
    mockState.authFileContent = '{}'
    mockState.fetchResponse = null
    mockReadAuthFile.mockImplementation(async () => mockState.authFileContent)
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
})
