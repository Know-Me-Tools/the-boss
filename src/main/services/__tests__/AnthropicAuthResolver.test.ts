import type { Provider } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetValidAccessToken } = vi.hoisted(() => ({
  mockGetValidAccessToken: vi.fn()
}))

vi.mock('@main/services/AnthropicService', () => ({
  default: {
    getValidAccessToken: mockGetValidAccessToken
  }
}))

import {
  ANTHROPIC_MAX_PROVIDER_ID,
  resolveAnthropicAuthToken,
  resolveClaudeCodeAnthropicCredentials,
  usesAnthropicAuthToken
} from '../AnthropicAuthResolver'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'anthropic',
    type: 'anthropic',
    name: 'Anthropic',
    apiKey: '',
    apiHost: 'https://api.anthropic.com/v1',
    models: [],
    authType: 'apiKey',
    ...overrides
  } as Provider
}

describe('AnthropicAuthResolver', () => {
  beforeEach(() => {
    mockGetValidAccessToken.mockReset()
  })

  it('prefers Anthropic OAuth credentials for anthropic-max', async () => {
    mockGetValidAccessToken.mockResolvedValue('oauth-token')

    const token = await resolveAnthropicAuthToken(
      makeProvider({
        id: ANTHROPIC_MAX_PROVIDER_ID,
        name: 'Anthropic Max',
        authType: 'oauth',
        apiKey: 'manual-token'
      })
    )

    expect(token).toBe('oauth-token')
  })

  it('falls back to the manual auth token for anthropic-max when OAuth is unavailable', async () => {
    mockGetValidAccessToken.mockResolvedValue(null)

    const token = await resolveAnthropicAuthToken(
      makeProvider({
        id: ANTHROPIC_MAX_PROVIDER_ID,
        name: 'Anthropic Max',
        authType: 'oauth',
        apiKey: 'manual-token'
      })
    )

    expect(token).toBe('manual-token')
  })

  it('returns null for anthropic-max when neither OAuth nor a manual token is available', async () => {
    mockGetValidAccessToken.mockResolvedValue(null)

    const token = await resolveAnthropicAuthToken(
      makeProvider({
        id: ANTHROPIC_MAX_PROVIDER_ID,
        name: 'Anthropic Max',
        authType: 'oauth',
        apiKey: ''
      })
    )

    expect(token).toBeNull()
  })

  it('treats Anthropic OAuth providers as auth-token backed', () => {
    expect(usesAnthropicAuthToken(makeProvider({ authType: 'oauth' }))).toBe(true)
    expect(usesAnthropicAuthToken(makeProvider({ id: ANTHROPIC_MAX_PROVIDER_ID, authType: 'oauth' }))).toBe(true)
    expect(usesAnthropicAuthToken(makeProvider({ authType: 'apiKey' }))).toBe(false)
  })

  it('builds Claude Code credentials from the resolved auth token with empty apiKey for OAuth', async () => {
    mockGetValidAccessToken.mockResolvedValue('oauth-token')

    const credentials = await resolveClaudeCodeAnthropicCredentials(
      makeProvider({
        id: ANTHROPIC_MAX_PROVIDER_ID,
        name: 'Anthropic Max',
        authType: 'oauth',
        apiKey: 'manual-token'
      })
    )

    // apiKey must be empty so the Claude Code SDK sends Authorization: Bearer
    // rather than x-api-key, which Anthropic rejects for OAuth tokens.
    expect(credentials).toEqual({
      apiKey: '',
      authToken: 'oauth-token'
    })
  })

  it('falls back to the provider apiKey for native Anthropic routes that are not auth-token backed', async () => {
    mockGetValidAccessToken.mockResolvedValue(null)

    const credentials = await resolveClaudeCodeAnthropicCredentials(
      makeProvider({
        id: 'openrouter',
        type: 'openai',
        apiKey: 'provider-key',
        anthropicApiHost: 'https://openrouter.ai/api'
      })
    )

    expect(credentials).toEqual({
      apiKey: 'provider-key',
      authToken: 'provider-key'
    })
  })
})
