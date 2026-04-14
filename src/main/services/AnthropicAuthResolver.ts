import type { Provider } from '@types'

import anthropicService from './AnthropicService'

export const ANTHROPIC_MAX_PROVIDER_ID = 'anthropic-max'

type ClaudeCodeAnthropicCredentials = {
  apiKey: string
  authToken: string
}

export function isAnthropicMaxProvider(provider?: Pick<Provider, 'id'> | null): boolean {
  return provider?.id === ANTHROPIC_MAX_PROVIDER_ID
}

export function usesAnthropicAuthToken(provider?: Provider | null): boolean {
  if (!provider) {
    return false
  }

  return isAnthropicMaxProvider(provider) || (provider.type === 'anthropic' && provider.authType === 'oauth')
}

export async function resolveAnthropicAuthToken(provider: Provider): Promise<string | null> {
  if (!usesAnthropicAuthToken(provider)) {
    return null
  }

  const oauthToken = await anthropicService.getValidAccessToken()
  if (oauthToken) {
    return oauthToken
  }

  if (isAnthropicMaxProvider(provider)) {
    const manualToken = provider.apiKey?.trim()
    return manualToken || null
  }

  return null
}

export async function resolveClaudeCodeAnthropicCredentials(
  provider: Provider
): Promise<ClaudeCodeAnthropicCredentials | null> {
  const authToken = await resolveAnthropicAuthToken(provider)
  if (authToken) {
    // For OAuth tokens, leave apiKey empty so the Claude Code SDK sends
    // "Authorization: Bearer <token>" instead of "x-api-key: <token>".
    // Anthropic's API rejects OAuth tokens presented as x-api-key.
    return {
      apiKey: '',
      authToken
    }
  }

  const apiKey = provider.apiKey?.trim()
  if (!apiKey) {
    return null
  }

  return {
    apiKey,
    authToken: apiKey
  }
}
