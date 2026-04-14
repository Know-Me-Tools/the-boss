import { createExecutor } from '@cherrystudio/ai-core'
import { formatPrivateKey, hasProviderConfig } from '@cherrystudio/ai-core/provider'
import { ensureMainProviderExtensionsRegistered } from '@main/aiCore/provider/extensions'
import { config as apiServerConfig } from '@main/apiServer/config'
import { getAnthropicInternalHeaders } from '@main/apiServer/middleware/anthropicOAuthInternalAuth'
import { resolveAnthropicAuthToken, usesAnthropicAuthToken } from '@main/services/AnthropicAuthResolver'
import { openAIOAuthService } from '@main/services/OpenAIOAuthService'
import { reduxService } from '@main/services/ReduxService'
import { defaultAppHeaders, formatApiHost, withoutTrailingSlash } from '@shared/utils'
import type { Model, Provider } from '@types'

type CompatExecutorConfig = {
  providerId: string
  providerSettings: Record<string, unknown>
}

type VertexAISettings = {
  projectId: string
  location: string
  serviceAccount: {
    clientEmail: string
    privateKey: string
  }
}

const SUPPORTED_ENDPOINT_LIST = [
  'chat/completions',
  'responses',
  'messages',
  'generateContent',
  'streamGenerateContent',
  'images/generations',
  'images/edits',
  'predict'
] as const

function routeToEndpoint(apiHost: string): { baseURL: string; endpoint: string } {
  const trimmedHost = apiHost.trim()
  if (!trimmedHost.endsWith('#')) {
    return { baseURL: trimmedHost, endpoint: '' }
  }

  const host = trimmedHost.slice(0, -1)
  const endpointMatch = SUPPORTED_ENDPOINT_LIST.find((endpoint) => host.endsWith(endpoint))
  if (!endpointMatch) {
    return { baseURL: withoutTrailingSlash(host), endpoint: '' }
  }

  const baseSegment = host.slice(0, host.length - endpointMatch.length)
  const baseURL = withoutTrailingSlash(baseSegment).replace(/:$/, '')
  return { baseURL, endpoint: endpointMatch }
}

async function getVertexAISettings(): Promise<VertexAISettings> {
  return (await reduxService.select('llm.settings.vertexai')) as VertexAISettings
}

function getAiSdkProviderId(provider: Provider, model: Model): string {
  if (provider.type === 'vertexai') {
    return model.id.startsWith('claude') ? 'google-vertex-anthropic' : 'google-vertex'
  }

  if (provider.type === 'openai-response') {
    return 'openai-compatible'
  }

  if (provider.type === 'openai') {
    return provider.apiHost.includes('api.openai.com') ? 'openai-chat' : 'openai-compatible'
  }

  if (provider.id === 'openai' && provider.authType === 'oauth') {
    return 'openai-compatible'
  }

  if (hasProviderConfig(provider.id)) {
    return provider.id
  }

  if (hasProviderConfig(provider.type)) {
    return provider.type
  }

  return 'openai-compatible'
}

async function buildVertexProviderConfig(provider: Provider, model: Model): Promise<CompatExecutorConfig> {
  const { baseURL } = routeToEndpoint(provider.apiHost)
  const settings = await getVertexAISettings()

  if (
    !settings.projectId ||
    !settings.location ||
    !settings.serviceAccount?.clientEmail ||
    !settings.serviceAccount?.privateKey
  ) {
    throw new Error(
      'Vertex AI is not configured. Set the project, location, and service account credentials before running agents.'
    )
  }

  const providerId = getAiSdkProviderId(provider, model)
  const publisherBaseUrl = `${baseURL}${providerId === 'google-vertex-anthropic' ? '/publishers/anthropic/models' : '/publishers/google'}`

  return {
    providerId,
    providerSettings: {
      apiKey: provider.apiKey,
      baseURL: publisherBaseUrl,
      headers: {
        ...defaultAppHeaders(),
        ...provider.extra_headers
      },
      location: settings.location,
      project: settings.projectId,
      googleCredentials: {
        clientEmail: settings.serviceAccount.clientEmail,
        privateKey: formatPrivateKey(settings.serviceAccount.privateKey)
      }
    }
  }
}

async function buildOpenAIProviderConfig(provider: Provider, model: Model): Promise<CompatExecutorConfig> {
  const providerId = getAiSdkProviderId(provider, model)

  if (provider.id === 'openai' && provider.authType === 'oauth') {
    const { host, port } = await apiServerConfig.get()
    const internalHeaders = await openAIOAuthService.getRequestHeaders()
    return {
      providerId: 'openai-compatible',
      providerSettings: {
        apiKey: 'oauth',
        baseURL: `http://${host}:${port}/_internal/openai-oauth`,
        headers: {
          ...defaultAppHeaders(),
          ...internalHeaders,
          ...provider.extra_headers
        },
        name: provider.id
      }
    }
  }

  const { baseURL } = routeToEndpoint(provider.apiHost)

  return {
    providerId,
    providerSettings: {
      apiKey: provider.apiKey,
      baseURL: withoutTrailingSlash(formatApiHost(baseURL, false)),
      headers: {
        ...defaultAppHeaders(),
        ...provider.extra_headers
      },
      name: provider.id
    }
  }
}

async function buildAnthropicProviderConfig(provider: Provider): Promise<CompatExecutorConfig> {
  // OAuth providers route through the API server's internal proxy
  if (provider.authType === 'oauth') {
    const { host, port } = await apiServerConfig.get()
    const internalHeaders = getAnthropicInternalHeaders()
    return {
      providerId: 'anthropic',
      providerSettings: {
        apiKey: '',
        baseURL: `http://${host}:${port}/_internal/anthropic-oauth`,
        headers: {
          ...defaultAppHeaders(),
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          ...internalHeaders,
          ...provider.extra_headers
        }
      }
    }
  }

  const authToken = await resolveAnthropicAuthToken(provider)
  if (!authToken) {
    throw new Error(`Provider '${provider.id}' is missing Anthropic credentials.`)
  }

  const { baseURL } = routeToEndpoint(provider.apiHost)

  return {
    providerId: 'anthropic',
    providerSettings: {
      apiKey: '',
      baseURL: withoutTrailingSlash(formatApiHost(baseURL, false)),
      headers: {
        ...defaultAppHeaders(),
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        Authorization: `Bearer ${authToken}`,
        ...provider.extra_headers
      }
    }
  }
}

export async function getCompatExecutor(provider: Provider, model: Model) {
  ensureMainProviderExtensionsRegistered()

  let config: CompatExecutorConfig
  if (provider.type === 'vertexai') {
    config = await buildVertexProviderConfig(provider, model)
  } else if (provider.type === 'anthropic' && usesAnthropicAuthToken(provider)) {
    config = await buildAnthropicProviderConfig(provider)
  } else {
    config = await buildOpenAIProviderConfig(provider, model)
  }

  return createExecutor(config.providerId as never, config.providerSettings as never)
}
