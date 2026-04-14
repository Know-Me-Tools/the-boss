import { createVertexAnthropic, type GoogleVertexAnthropicProvider } from '@ai-sdk/google-vertex/anthropic/edge'
import { createVertex, type GoogleVertexProvider, type GoogleVertexProviderSettings } from '@ai-sdk/google-vertex/edge'
import { extensionRegistry, ProviderExtension, type ProviderExtensionConfig } from '@cherrystudio/ai-core/provider'

const GoogleVertexExtension = ProviderExtension.create({
  name: 'google-vertex',
  aliases: ['vertexai'] as const,
  supportsImageGeneration: true,
  create: createVertex
} as const satisfies ProviderExtensionConfig<GoogleVertexProviderSettings, GoogleVertexProvider, 'google-vertex'>)

const GoogleVertexAnthropicExtension = ProviderExtension.create({
  name: 'google-vertex-anthropic',
  aliases: ['vertexai-anthropic'] as const,
  supportsImageGeneration: true,
  create: createVertexAnthropic
} as const satisfies ProviderExtensionConfig<
  GoogleVertexProviderSettings,
  GoogleVertexAnthropicProvider,
  'google-vertex-anthropic'
>)

export function ensureMainProviderExtensionsRegistered(): void {
  for (const extension of [GoogleVertexExtension, GoogleVertexAnthropicExtension]) {
    if (!extensionRegistry.has(extension.config.name)) {
      extensionRegistry.register(extension)
    }
  }
}

ensureMainProviderExtensionsRegistered()
