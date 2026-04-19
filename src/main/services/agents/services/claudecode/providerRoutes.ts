import type { Provider } from '@types'

export type ClaudeCodeProviderRoute = 'native_anthropic'

export function resolveClaudeCodeProviderRoute(provider: Provider): ClaudeCodeProviderRoute | null {
  if (provider.type === 'anthropic' || provider.type === 'azure-openai' || !!provider.anthropicApiHost?.trim()) {
    return 'native_anthropic'
  }

  return null
}
