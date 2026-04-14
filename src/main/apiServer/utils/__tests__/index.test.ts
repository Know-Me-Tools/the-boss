import type { Provider } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCacheGet = vi.fn()
const mockCacheSet = vi.fn()
const mockReduxSelect = vi.fn()
const mockFormatProviderApiHost = vi.fn(async (provider: Provider) => provider)

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

vi.mock('@main/services/CacheService', () => ({
  CacheService: {
    get: (key: string) => mockCacheGet(key),
    set: (key: string, value: unknown, ttl?: number) => mockCacheSet(key, value, ttl)
  }
}))

vi.mock('@main/services/ReduxService', () => ({
  reduxService: {
    select: (selector: string) => mockReduxSelect(selector)
  }
}))

vi.mock('@main/aiCore/provider/providerConfig', () => ({
  formatProviderApiHost: (provider: Provider) => mockFormatProviderApiHost(provider)
}))

import { getAvailableProviders, validateModelId, validateProvider } from '../index'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'provider-id',
    type: 'openai',
    authType: 'apiKey',
    apiHost: 'https://api.example.com',
    anthropicApiHost: '',
    apiKey: 'provider-key',
    enabled: true,
    models: [],
    ...overrides
  } as Provider
}

describe('apiServer utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCacheGet.mockReturnValue(undefined)
    mockReduxSelect.mockResolvedValue([])
  })

  it('includes OpenAI Responses and Vertex providers in the available provider list', async () => {
    const openaiResponse = makeProvider({ id: 'openai', type: 'openai-response' })
    const vertex = makeProvider({ id: 'vertex', type: 'vertexai' })
    const unsupported = makeProvider({ id: 'gemini', type: 'gemini' as Provider['type'] })
    const disabled = makeProvider({ id: 'disabled-openai', type: 'openai', enabled: false })

    mockReduxSelect.mockResolvedValue([openaiResponse, vertex, unsupported, disabled])

    const providers = await getAvailableProviders()

    expect(providers.map((provider) => provider.id)).toEqual(['openai', 'vertex'])
    expect(mockFormatProviderApiHost).toHaveBeenCalledTimes(2)
    expect(mockCacheSet).toHaveBeenCalled()
  })

  it('returns an agent-runtime specific provider-not-found error message', async () => {
    const result = await validateModelId('missing:gpt-5')

    expect(result.valid).toBe(false)
    expect(result.error).toMatchObject({
      type: 'provider_not_found',
      message: "Provider 'missing' not found, not enabled, or not supported by the agents runtime."
    })
  })

  it('accepts OpenAI Responses and Vertex providers during validation', () => {
    expect(validateProvider(makeProvider({ type: 'openai-response' }))).toBe(true)
    expect(validateProvider(makeProvider({ type: 'vertexai' }))).toBe(true)
    expect(validateProvider(makeProvider({ type: 'new-api' }))).toBe(false)
  })
})
