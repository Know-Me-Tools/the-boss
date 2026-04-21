import type { Provider } from '@types'
import { describe, expect, it } from 'vitest'

import { resolveClaudeCodeProviderRoute } from '../providerRoutes'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'provider-id',
    type: 'anthropic',
    authType: 'apiKey',
    apiHost: 'https://api.example.com',
    anthropicApiHost: '',
    apiKey: 'provider-key',
    enabled: true,
    models: [],
    ...overrides
  } as Provider
}

describe('providerRoutes', () => {
  it('does not route OpenAI-compatible providers through the Claude runtime', () => {
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'openai' }))).toBeNull()
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'openai-response' }))).toBeNull()
  })

  it('does not route Vertex providers through the Claude runtime', () => {
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'vertexai' }))).toBeNull()
  })

  it('routes all Anthropic providers (including OAuth) through the native_anthropic route', () => {
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'anthropic' }))).toBe('native_anthropic')
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'anthropic', authType: 'apiKey' }))).toBe(
      'native_anthropic'
    )
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'anthropic', authType: 'oauth' }))).toBe(
      'native_anthropic'
    )
    expect(
      resolveClaudeCodeProviderRoute(makeProvider({ type: 'new-api', anthropicApiHost: 'https://anthropic.proxy/v1' }))
    ).toBe('native_anthropic')
  })

  it('returns null for providers without a supported route', () => {
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'gemini' }))).toBeNull()
  })
})
