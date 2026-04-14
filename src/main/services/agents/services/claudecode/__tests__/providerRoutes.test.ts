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
  it('routes OpenAI-compatible providers through the local compatibility proxy', () => {
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'openai' }))).toBe('compat_proxy_openai')
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'openai-response' }))).toBe('compat_proxy_openai')
  })

  it('routes Vertex providers through the local compatibility proxy', () => {
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'vertexai' }))).toBe('compat_proxy_vertex')
  })

  it('routes all Anthropic providers (including OAuth) through the native_anthropic route', () => {
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'anthropic' }))).toBe('native_anthropic')
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'anthropic', authType: 'apiKey' }))).toBe('native_anthropic')
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'anthropic', authType: 'oauth' }))).toBe('native_anthropic')
    expect(
      resolveClaudeCodeProviderRoute(makeProvider({ type: 'new-api', anthropicApiHost: 'https://anthropic.proxy/v1' }))
    ).toBe('native_anthropic')
  })

  it('returns null for providers without a supported route', () => {
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'gemini' }))).toBeNull()
  })

  it('routes OpenAI OAuth through the OpenAI compat proxy (OAuth token injected server-side)', () => {
    expect(resolveClaudeCodeProviderRoute(makeProvider({ type: 'openai', authType: 'oauth' }))).toBe('compat_proxy_openai')
    expect(
      resolveClaudeCodeProviderRoute(makeProvider({ type: 'openai-response', authType: 'oauth' }))
    ).toBe('compat_proxy_openai')
  })
})
