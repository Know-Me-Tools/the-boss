import type { Provider } from '@types'

export type ClaudeCodeProviderRoute = 'native_anthropic' | 'compat_proxy_openai' | 'compat_proxy_vertex'

export function resolveClaudeCodeProviderRoute(provider: Provider): ClaudeCodeProviderRoute | null {
  if (provider.type === 'vertexai') {
    return 'compat_proxy_vertex'
  }

  if (provider.type === 'openai' || provider.type === 'openai-response') {
    return 'compat_proxy_openai'
  }

  if (provider.type === 'anthropic' || provider.type === 'azure-openai' || !!provider.anthropicApiHost?.trim()) {
    return 'native_anthropic'
  }

  return null
}
