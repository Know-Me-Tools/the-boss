import { loggerService } from '@logger'
import { AiProvider } from '@renderer/aiCore'
import { buildProviderOptions } from '@renderer/aiCore/utils/options'
import { getStoreProviders } from '@renderer/hooks/useStore'
import { getDefaultAssistant, getDefaultModel, getProviderByModel } from '@renderer/services/AssistantService'
import type { Model } from '@renderer/types'
import type { SkillGlobalConfig } from '@renderer/types/skillConfig'
import {
  getSkillMethodEmbeddingModelId,
  getSkillMethodLlmModelId,
  getSkillMethodSimilarityThreshold,
  getSkillMethodTopK,
  SkillSelectionMethod
} from '@renderer/types/skillConfig'

import { EmbeddingResolver } from './embeddingResolver'
import type { SkillDescriptor, SkillRegistry } from './skillRegistry'
import { skillRegistry as defaultRegistry } from './skillRegistry'

const logger = loggerService.withContext('SkillSelector')

export interface SkillSelectorResult {
  skill: SkillDescriptor
  /** Similarity / relevance score in [0, 1] */
  score: number
  /** Tokens that matched trigger patterns (empty for pure embedding methods) */
  matchedKeywords: string[]
  /** Human-readable description of why the skill was selected */
  selectionReason: string
  /** Which selection method produced this result */
  activationMethod: SkillSelectionMethod
}

type SkillSelectorMode = 'router' | 'delegated'

type LlmSkillSelectionCandidate = {
  id: string
  name: string
  description: string
  similarityScore: number
  matchedKeywords: string[]
}

type LlmSkillSelectionChoice = {
  id: string
  reason?: string
}

type LlmSkillSelectionResponse = {
  selections: LlmSkillSelectionChoice[]
}

type LlmSkillSelectionRequest = {
  mode: SkillSelectorMode
  prompt: string
  candidates: LlmSkillSelectionCandidate[]
  model?: Model
}

type LlmSelectionInvoker = (request: LlmSkillSelectionRequest) => Promise<LlmSkillSelectionResponse>

const DEFAULT_LLM_SELECTION_CANDIDATE_LIMIT = 12

// ─────────────────────────────────────────────────────────────────────────────
// BM25 helpers (simplified – no k1/b tuning)
// ─────────────────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(Boolean)
}

function computeBm25Scores(prompt: string, skills: SkillDescriptor[]): Map<string, number> {
  const promptTokens = tokenize(prompt)
  const N = skills.length

  const df = new Map<string, number>()
  for (const skill of skills) {
    const docTokens = new Set(tokenize(skill.description))
    for (const token of docTokens) {
      df.set(token, (df.get(token) ?? 0) + 1)
    }
  }

  const scores = new Map<string, number>()
  for (const skill of skills) {
    const docTokens = tokenize(skill.description)
    let score = 0
    for (const term of promptTokens) {
      const termDf = df.get(term) ?? 0
      if (termDf === 0) continue
      const idf = Math.log((N + 1) / (termDf + 1))
      const tf = docTokens.filter((token) => token === term).length / docTokens.length
      score += idf * tf
    }
    scores.set(skill.id, score)
  }

  return scores
}

// ─────────────────────────────────────────────────────────────────────────────
// SkillSelector
// ─────────────────────────────────────────────────────────────────────────────

export class SkillSelector {
  private readonly config: SkillGlobalConfig
  private readonly resolver: EmbeddingResolver
  private readonly registry: SkillRegistry
  private readonly llmSelectionInvoker: LlmSelectionInvoker
  private readonly activeModel?: Model
  private readonly topK: number
  private readonly similarityThreshold: number

  constructor(
    config: SkillGlobalConfig,
    resolver?: EmbeddingResolver,
    registry?: SkillRegistry,
    llmSelectionInvoker?: LlmSelectionInvoker,
    activeModelOrId?: Model | string
  ) {
    this.config = config
    this.registry = registry ?? defaultRegistry
    this.activeModel = resolveModelReference(activeModelOrId) ?? getDefaultModel()
    this.topK = getSkillMethodTopK(config)
    this.similarityThreshold = getSkillMethodSimilarityThreshold(config)
    this.resolver = resolver ?? new EmbeddingResolver(getSkillMethodEmbeddingModelId(config))
    this.llmSelectionInvoker = llmSelectionInvoker ?? invokeLlmSkillSelection
  }

  async select(prompt: string, skills: SkillDescriptor[]): Promise<SkillSelectorResult[]> {
    if (skills.length === 0 || this.topK === 0) return []

    switch (this.config.selectionMethod) {
      case SkillSelectionMethod.EMBEDDING:
        return this.selectByEmbedding(prompt, skills)

      case SkillSelectionMethod.HYBRID:
        return this.selectByHybrid(prompt, skills)

      case SkillSelectionMethod.TWO_STAGE:
        return this.selectByTwoStage(prompt, skills)

      case SkillSelectionMethod.LLM_ROUTER:
        return this.selectByLlm(prompt, skills, 'router', SkillSelectionMethod.LLM_ROUTER)

      case SkillSelectionMethod.LLM_DELEGATED:
        return this.selectByLlm(prompt, skills, 'delegated', SkillSelectionMethod.LLM_DELEGATED)

      default:
        return this.selectByEmbedding(prompt, skills)
    }
  }

  private async selectByEmbedding(prompt: string, skills: SkillDescriptor[]): Promise<SkillSelectorResult[]> {
    const promptVec = await this.resolver.embed(prompt)
    const scored = await this.scoreByEmbedding(promptVec, skills)

    return scored
      .filter((result) => result.score >= this.similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.topK)
      .map((result) => ({
        skill: result.skill,
        score: result.score,
        matchedKeywords: [],
        selectionReason: `Semantic similarity: ${result.score.toFixed(2)}`,
        activationMethod: SkillSelectionMethod.EMBEDDING
      }))
  }

  private async selectByEmbeddingWithOverride(
    prompt: string,
    skills: SkillDescriptor[],
    activationMethod: SkillSelectionMethod,
    selectionReason: string
  ): Promise<SkillSelectorResult[]> {
    const promptVec = await this.resolver.embed(prompt)
    const scored = await this.scoreByEmbedding(promptVec, skills)

    return scored
      .filter((result) => result.score >= this.similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.topK)
      .map((result) => ({
        skill: result.skill,
        score: result.score,
        matchedKeywords: this.registry.getMatchedTokens(result.skill, prompt),
        selectionReason,
        activationMethod
      }))
  }

  private async selectByHybrid(prompt: string, skills: SkillDescriptor[]): Promise<SkillSelectorResult[]> {
    const promptVec = await this.resolver.embed(prompt)

    const bm25Map = computeBm25Scores(prompt, skills)
    const bm25Ranked = [...skills].sort((a, b) => (bm25Map.get(b.id) ?? 0) - (bm25Map.get(a.id) ?? 0))

    const denseScored = await this.scoreByEmbedding(promptVec, skills)
    const denseRanked = [...denseScored].sort((a, b) => b.score - a.score)

    const bm25Rank = new Map(bm25Ranked.map((skill, index) => [skill.id, index + 1]))
    const denseRank = new Map(denseRanked.map((result, index) => [result.skill.id, index + 1]))
    const denseScoreMap = new Map(denseScored.map((result) => [result.skill.id, result.score]))

    const rrfScores = skills.map((skill) => {
      const bm25Position = bm25Rank.get(skill.id) ?? skills.length + 1
      const densePosition = denseRank.get(skill.id) ?? skills.length + 1
      const rrf = 1 / (60 + bm25Position) + 1 / (60 + densePosition)
      return { skill, rrf, denseScore: denseScoreMap.get(skill.id) ?? 0 }
    })

    return rrfScores
      .sort((a, b) => b.rrf - a.rrf)
      .slice(0, this.topK)
      .map(({ skill, rrf }) => ({
        skill,
        score: rrf,
        matchedKeywords: this.registry.getMatchedTokens(skill, prompt),
        selectionReason: `Hybrid BM25+dense (RRF): ${rrf.toFixed(3)}`,
        activationMethod: SkillSelectionMethod.HYBRID
      }))
  }

  private async selectByTwoStage(prompt: string, skills: SkillDescriptor[]): Promise<SkillSelectorResult[]> {
    const bm25Map = computeBm25Scores(prompt, skills)
    const bm25TopK = [...skills].sort((a, b) => (bm25Map.get(b.id) ?? 0) - (bm25Map.get(a.id) ?? 0)).slice(0, this.topK)

    const triggerMatches = skills.filter((skill) => this.registry.matchesTriggers(skill, prompt))

    const seen = new Set<string>()
    const candidates: SkillDescriptor[] = []
    for (const skill of [...triggerMatches, ...bm25TopK]) {
      if (!seen.has(skill.id)) {
        seen.add(skill.id)
        candidates.push(skill)
      }
    }

    if (candidates.length === 0) return []

    const promptVec = await this.resolver.embed(prompt)
    const reRanked = await this.scoreByEmbedding(promptVec, candidates)

    return reRanked
      .filter((result) => result.score >= this.similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.topK)
      .map((result) => ({
        skill: result.skill,
        score: result.score,
        matchedKeywords: this.registry.getMatchedTokens(result.skill, prompt),
        selectionReason: `Two-stage (keyword→embedding): ${result.score.toFixed(2)}`,
        activationMethod: SkillSelectionMethod.TWO_STAGE
      }))
  }

  private async selectByLlm(
    prompt: string,
    skills: SkillDescriptor[],
    mode: SkillSelectorMode,
    activationMethod: SkillSelectionMethod
  ): Promise<SkillSelectorResult[]> {
    const candidates = await this.buildEmbeddingCandidatePool(prompt, skills)
    if (candidates.length === 0) {
      return []
    }

    const model = resolveModelReference(getSkillMethodLlmModelId(this.config)) ?? this.activeModel
    if (!model) {
      return this.selectByEmbeddingWithOverride(
        prompt,
        skills,
        activationMethod,
        `LLM ${mode} fallback to embedding: no routing model available`
      )
    }

    try {
      const response = await this.llmSelectionInvoker({
        mode,
        prompt,
        candidates: candidates.map((candidate) => ({
          id: candidate.skill.id,
          name: candidate.skill.name,
          description: candidate.skill.description,
          similarityScore: candidate.score,
          matchedKeywords: this.registry.getMatchedTokens(candidate.skill, prompt)
        })),
        model
      })

      const candidateMap = new Map(
        candidates.map((candidate) => [
          candidate.skill.id,
          {
            candidate,
            matchedKeywords: this.registry.getMatchedTokens(candidate.skill, prompt)
          }
        ])
      )

      const validSelections = response.selections
        .filter((selection) => candidateMap.has(selection.id))
        .filter((selection, index, list) => list.findIndex((item) => item.id === selection.id) === index)
        .slice(0, this.topK)

      if (validSelections.length === 0) {
        throw new Error('No valid skill IDs returned by LLM selection')
      }

      return validSelections.map((selection, index) => {
        const matched = candidateMap.get(selection.id)!
        const reasonPrefix = mode === 'router' ? 'LLM router ranking' : 'LLM delegated selection'
        return {
          skill: matched.candidate.skill,
          score: Math.max(matched.candidate.score, 1 - index * 0.05),
          matchedKeywords: matched.matchedKeywords,
          selectionReason: selection.reason
            ? `${reasonPrefix}: ${selection.reason}`
            : `${reasonPrefix}: ${selection.id}`,
          activationMethod
        }
      })
    } catch (error) {
      const message = getSelectionFailureReason(error)
      logger.warn(`LLM skill ${mode} failed, falling back to embedding`, {
        error: message,
        selectionMethod: activationMethod,
        configuredModelId: getSkillMethodLlmModelId(this.config),
        activeModelId: this.activeModel?.id
      })

      return this.selectByEmbeddingWithOverride(
        prompt,
        skills,
        activationMethod,
        `LLM ${mode} fallback to embedding: ${message}`
      )
    }
  }

  private async buildEmbeddingCandidatePool(
    prompt: string,
    skills: SkillDescriptor[]
  ): Promise<Array<{ skill: SkillDescriptor; score: number }>> {
    const promptVec = await this.resolver.embed(prompt)
    const candidateLimit = Math.min(DEFAULT_LLM_SELECTION_CANDIDATE_LIMIT, Math.max(this.topK * 4, this.topK))

    return (await this.scoreByEmbedding(promptVec, skills))
      .filter((candidate) => candidate.score >= this.similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, candidateLimit)
  }

  private async scoreByEmbedding(
    promptVec: number[],
    skills: SkillDescriptor[]
  ): Promise<Array<{ skill: SkillDescriptor; score: number }>> {
    return Promise.all(
      skills.map(async (skill) => {
        const descVec = await this.resolver.embed(skill.description)
        const score = this.resolver.cosineSimilarity(promptVec, descVec)
        return { skill, score }
      })
    )
  }
}

async function invokeLlmSkillSelection(request: LlmSkillSelectionRequest): Promise<LlmSkillSelectionResponse> {
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

function buildLlmSelectionUserPrompt(request: LlmSkillSelectionRequest): string {
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

function getSelectionFailureReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'unknown LLM routing error'
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
