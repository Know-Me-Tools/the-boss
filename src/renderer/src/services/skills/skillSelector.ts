import { AiProvider } from '@renderer/aiCore'
import { buildProviderOptions } from '@renderer/aiCore/utils/options'
import { getStoreProviders } from '@renderer/hooks/useStore'
import { getDefaultAssistant, getDefaultModel, getProviderByModel } from '@renderer/services/AssistantService'
import type { Model } from '@renderer/types'
import type { SkillGlobalConfig } from '@renderer/types/skillConfig'
import { getSkillMethodEmbeddingModelId } from '@renderer/types/skillConfig'

import { EmbeddingResolver } from './embeddingResolver'
import type { SkillRegistry } from './skillRegistry'
import { skillRegistry as defaultRegistry } from './skillRegistry'
import {
  type LlmSkillSelectionChoice,
  type LlmSkillSelectionRequest,
  type LlmSkillSelectionResponse,
  SkillSelectorCore,
  type SkillSelectorMode
} from './skillSelectorCore'

export class SkillSelector extends SkillSelectorCore<Model> {
  constructor(
    config: SkillGlobalConfig,
    resolver?: EmbeddingResolver,
    registry?: SkillRegistry,
    llmSelectionInvoker?: (request: LlmSkillSelectionRequest<Model>) => Promise<LlmSkillSelectionResponse>,
    activeModelOrId?: Model | string
  ) {
    super({
      config,
      registry: registry ?? defaultRegistry,
      activeModel: resolveModelReference(activeModelOrId) ?? getDefaultModel(),
      resolver: resolver ?? new EmbeddingResolver(getSkillMethodEmbeddingModelId(config)),
      llmSelectionInvoker: llmSelectionInvoker ?? invokeLlmSkillSelection,
      resolveModelReference
    })
  }
}

async function invokeLlmSkillSelection(request: LlmSkillSelectionRequest<Model>): Promise<LlmSkillSelectionResponse> {
  if (!request.model) {
    throw new Error('No model available for LLM skill selection')
  }

  const assistant = {
    ...getDefaultAssistant(),
    model: request.model
  }
  const aiProvider = new AiProvider(request.model)
  const provider = getProviderByModel(request.model)
  const actualProvider = aiProvider.getActualProvider() ?? provider
  const { providerOptions, standardParams } = buildProviderOptions(assistant, request.model, actualProvider, {
    enableReasoning: false,
    enableWebSearch: false,
    enableGenerateImage: false
  })

  const result = await aiProvider.completions(
    request.model.id,
    {
      system: buildLlmSelectionSystemPrompt(request.mode),
      messages: [
        {
          role: 'user',
          content: buildLlmSelectionUserPrompt(request)
        }
      ],
      providerOptions,
      maxOutputTokens: 600,
      ...standardParams
    },
    {
      streamOutput: false,
      enableReasoning: false,
      isPromptToolUse: false,
      isSupportedToolUse: false,
      enableWebSearch: false,
      enableGenerateImage: false,
      enableUrlContext: false,
      mcpTools: [],
      assistant,
      callType: request.mode === 'router' ? 'skill-router' : 'skill-delegated'
    }
  )

  return parseLlmSkillSelectionResponse(result.getText())
}

function buildLlmSelectionSystemPrompt(mode: SkillSelectorMode): string {
  if (mode === 'router') {
    return [
      'You are a deterministic skill router.',
      'Return only JSON with the shape {"selections":[{"id":"skill-id","reason":"short reason"}]}.',
      'Use only IDs from the provided candidate list.',
      'Rank the best candidates first and keep reasons brief.'
    ].join(' ')
  }

  return [
    'You are a deterministic skill selection delegate.',
    'Return only JSON with the shape {"selections":[{"id":"skill-id","reason":"short reason"}]}.',
    'Use only IDs from the provided candidate list.',
    'Select the final skills that should be activated for the user prompt and explain each choice briefly.'
  ].join(' ')
}

function buildLlmSelectionUserPrompt(request: LlmSkillSelectionRequest<Model>): string {
  return [
    `Mode: ${request.mode}`,
    `User prompt: ${request.prompt}`,
    'Candidate skills:',
    JSON.stringify(request.candidates, null, 2),
    'Return the JSON object only.'
  ].join('\n\n')
}

function parseLlmSkillSelectionResponse(text: string): LlmSkillSelectionResponse {
  const trimmed = text.trim()
  const jsonText = extractJsonObject(trimmed)
  const parsed = JSON.parse(jsonText) as Partial<LlmSkillSelectionResponse>

  if (!Array.isArray(parsed.selections)) {
    throw new Error('LLM selection response did not include a selections array')
  }

  return {
    selections: parsed.selections
      .filter((selection): selection is LlmSkillSelectionChoice => typeof selection?.id === 'string')
      .map((selection) => ({
        id: selection.id,
        reason: typeof selection.reason === 'string' ? selection.reason : undefined
      }))
  }
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM selection response did not contain valid JSON')
  }

  return text.slice(start, end + 1)
}

function resolveModelReference(modelOrId?: Model | string): Model | undefined {
  if (!modelOrId) {
    return undefined
  }

  if (typeof modelOrId !== 'string') {
    return modelOrId
  }

  const providers = getStoreProviders()

  if (looksLikeSerializedModelRef(modelOrId)) {
    try {
      const parsed = JSON.parse(modelOrId) as { id?: string; provider?: string }
      if (!parsed.id) {
        return undefined
      }
      return providers
        .find((provider) => provider.id === parsed.provider)
        ?.models.find((model) => model.id === parsed.id)
    } catch {
      return undefined
    }
  }

  return providers.flatMap((provider) => provider.models).find((model) => model.id === modelOrId)
}

function looksLikeSerializedModelRef(value: string): boolean {
  return value.startsWith('{') && value.includes('"id"')
}
