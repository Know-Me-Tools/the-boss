import type { Model, Provider } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateExecutor, mockResolveAnthropicAuthToken, mockUsesAnthropicAuthToken } = vi.hoisted(() => ({
  mockCreateExecutor: vi.fn(),
  mockResolveAnthropicAuthToken: vi.fn(),
  mockUsesAnthropicAuthToken: vi.fn()
}))

vi.mock('@cherrystudio/ai-core', () => ({
  createExecutor: (...args: unknown[]) => mockCreateExecutor(...args)
}))

vi.mock('@main/aiCore/provider/extensions', () => ({
  ensureMainProviderExtensionsRegistered: vi.fn()
}))

vi.mock('@main/services/AnthropicAuthResolver', () => ({
  resolveAnthropicAuthToken: (...args: unknown[]) => mockResolveAnthropicAuthToken(...args),
  usesAnthropicAuthToken: (...args: unknown[]) => mockUsesAnthropicAuthToken(...args)
}))

const { mockOpenAIOAuthRequestHeaders } = vi.hoisted(() => ({
  mockOpenAIOAuthRequestHeaders: vi.fn()
}))

vi.mock('@main/services/OpenAIOAuthService', () => ({
  openAIOAuthService: {
    getRequestHeaders: mockOpenAIOAuthRequestHeaders
  }
}))

const { mockApiServerConfigGet } = vi.hoisted(() => ({
  mockApiServerConfigGet: vi.fn()
}))

vi.mock('@main/apiServer/config', () => ({
  config: {
    get: mockApiServerConfigGet
  }
}))

const { mockGetAnthropicInternalHeaders } = vi.hoisted(() => ({
  mockGetAnthropicInternalHeaders: vi.fn()
}))

vi.mock('@main/apiServer/middleware/anthropicOAuthInternalAuth', () => ({
  getAnthropicInternalHeaders: mockGetAnthropicInternalHeaders
}))

vi.mock('@main/services/ReduxService', () => ({
  reduxService: {
    select: vi.fn()
  }
}))

import { getCompatExecutor } from '../runtimeConfig'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'anthropic-max',
    type: 'anthropic',
    name: 'Anthropic Max',
    apiKey: '',
    apiHost: 'https://api.anthropic.com/v1',
    models: [],
    authType: 'oauth',
    ...overrides
  } as Provider
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'claude-sonnet-4-5',
    provider: 'anthropic-max',
    name: 'Claude Sonnet 4.5',
    ...overrides
  } as Model
}

describe('getCompatExecutor', () => {
  beforeEach(() => {
    mockCreateExecutor.mockReset()
    mockResolveAnthropicAuthToken.mockReset()
    mockUsesAnthropicAuthToken.mockReset()
    mockOpenAIOAuthRequestHeaders.mockReset()
    mockApiServerConfigGet.mockReset()
    mockGetAnthropicInternalHeaders.mockReset()
    mockCreateExecutor.mockReturnValue({ execute: vi.fn() })
  })

  it('routes Anthropic OAuth through API server internal proxy', async () => {
    mockUsesAnthropicAuthToken.mockReturnValue(true)
    mockApiServerConfigGet.mockResolvedValue({ host: '127.0.0.1', port: 23333 })
    mockGetAnthropicInternalHeaders.mockReturnValue({ 'x-cherry-anthropic-oauth-secret': 'internal-secret' })

    await getCompatExecutor(makeProvider({ authType: 'oauth' }), makeModel())

    expect(mockCreateExecutor).toHaveBeenCalledWith(
      'anthropic',
      expect.objectContaining({
        apiKey: '',
        baseURL: 'http://127.0.0.1:23333/_internal/anthropic-oauth',
        headers: expect.objectContaining({
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'x-cherry-anthropic-oauth-secret': 'internal-secret'
        })
      })
    )
    expect(mockResolveAnthropicAuthToken).not.toHaveBeenCalled()
  })

  it('builds Anthropic bearer-auth runtime config for non-OAuth anthropic-max', async () => {
    mockUsesAnthropicAuthToken.mockReturnValue(true)
    mockResolveAnthropicAuthToken.mockResolvedValue('manual-token')

    await getCompatExecutor(makeProvider({ authType: undefined }), makeModel())

    expect(mockCreateExecutor).toHaveBeenCalledWith(
      'anthropic',
      expect.objectContaining({
        apiKey: '',
        baseURL: 'https://api.anthropic.com/v1',
        headers: expect.objectContaining({
          Authorization: 'Bearer manual-token',
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://the-boss.know-me.tools',
          'X-Title': 'The Boss'
        })
      })
    )
  })

  it('throws when non-OAuth anthropic-max has no resolved auth token', async () => {
    mockUsesAnthropicAuthToken.mockReturnValue(true)
    mockResolveAnthropicAuthToken.mockResolvedValue(null)

    await expect(getCompatExecutor(makeProvider({ authType: undefined }), makeModel())).rejects.toThrow(
      "Provider 'anthropic-max' is missing Anthropic credentials."
    )
    expect(mockCreateExecutor).not.toHaveBeenCalled()
  })

  it('builds internal OpenAI OAuth runtime config using API server endpoint', async () => {
    mockUsesAnthropicAuthToken.mockReturnValue(false)
    mockApiServerConfigGet.mockResolvedValue({ host: '127.0.0.1', port: 23333 })
    mockOpenAIOAuthRequestHeaders.mockResolvedValue({ 'x-cherry-openai-oauth-secret': 'internal-secret' })

    await getCompatExecutor(
      makeProvider({
        id: 'openai',
        type: 'openai',
        authType: 'oauth',
        apiHost: 'https://api.openai.com/v1',
        extra_headers: { 'x-extra': 'value' }
      }),
      makeModel({ id: 'gpt-5.4' })
    )

    expect(mockCreateExecutor).toHaveBeenCalledWith(
      'openai-compatible',
      expect.objectContaining({
        apiKey: 'oauth',
        baseURL: 'http://127.0.0.1:23333/_internal/openai-oauth',
        headers: expect.objectContaining({
          'HTTP-Referer': 'https://the-boss.know-me.tools',
          'X-Title': 'The Boss',
          'x-cherry-openai-oauth-secret': 'internal-secret',
          'x-extra': 'value'
        }),
        name: 'openai'
      })
    )
  })
})
