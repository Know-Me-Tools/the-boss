import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAvailableProviders = vi.fn()
const mockListAllAvailableModels = vi.fn()
const mockGetProviderAnthropicModelChecker = vi.fn()
const mockTransformModelToOpenAI = vi.fn((model: any, provider: any) => ({
  id: `${provider.id}:${model.id}`,
  object: 'model',
  name: model.name,
  created: 0,
  owned_by: provider.id,
  provider: provider.id,
  provider_name: provider.name,
  provider_type: provider.type,
  provider_model_id: model.id
}))

vi.mock('../../services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('../../utils', () => ({
  getAvailableProviders: () => mockGetAvailableProviders(),
  getProviderAnthropicModelChecker: (providerId: string) => mockGetProviderAnthropicModelChecker(providerId),
  listAllAvailableModels: (providers: unknown[]) => mockListAllAvailableModels(providers),
  transformModelToOpenAI: (model: any, provider: any) => mockTransformModelToOpenAI(model, provider)
}))

import { ModelsService } from '../models'

describe('ModelsService', () => {
  const service = new ModelsService()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProviderAnthropicModelChecker.mockReturnValue(() => true)
  })

  it('returns OpenAI Responses and Vertex models in the API model list', async () => {
    const providers = [
      {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai-response'
      },
      {
        id: 'vertex',
        name: 'Vertex',
        type: 'vertexai'
      }
    ]
    const models = [
      { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai' },
      { id: 'claude-3-7-sonnet', name: 'Claude Sonnet', provider: 'vertex' }
    ]

    mockGetAvailableProviders.mockResolvedValue(providers)
    mockListAllAvailableModels.mockResolvedValue(models)

    const response = await service.getModels({})

    expect(response.data.map((model) => model.id)).toEqual(['openai:gpt-5.4', 'vertex:claude-3-7-sonnet'])
  })
})
