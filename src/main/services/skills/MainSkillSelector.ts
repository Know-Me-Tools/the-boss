import type { ChatCompletionCreateParams } from '@cherrystudio/openai/resources'
import { loggerService } from '@logger'
import { chatCompletionService } from '@main/apiServer/services/chat-completion'
import type { SkillGlobalConfig } from '@types'
import {
  getSkillMethodEmbeddingModelId,
  getSkillMethodLlmModelId,
  getSkillMethodSimilarityThreshold,
  getSkillMethodTopK,
  SkillSelectionMethod
} from '@types'

import { MainEmbeddingResolver } from './MainEmbeddingResolver'
import type { SkillDescriptor, SkillRegistry } from './skillRegistry'

const logger = loggerService.withContext('MainSkillSelector')

export interface SkillSelectorResult {
  skill: SkillDescriptor
  score: number
  matchedKeywords: string[]
  selectionReason: string
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

type LlmSkillSelectionResponse = {
  selections: Array<{
    id: string
    reason?: string
  }>
}

type LlmSkillSelectionRequest = {
  mode: SkillSelectorMode
  prompt: string
  candidates: LlmSkillSelectionCandidate[]
  model?: string
}

const DEFAULT_LLM_SELECTION_CANDIDATE_LIMIT = 12

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(Boolean)
}

function computeBm25Scores(prompt: string, skills: SkillDescriptor[]): Map<string, number> {
  const promptTokens = tokenize(prompt)
  const totalDocuments = skills.length
  const documentFrequencies = new Map<string, number>()

  for (const skill of skills) {
    const uniqueTokens = new Set(tokenize(skill.description))
    for (const token of uniqueTokens) {
      documentFrequencies.set(token, (documentFrequencies.get(token) ?? 0) + 1)
    }
  }

  const scores = new Map<string, number>()
  for (const skill of skills) {
    const descriptionTokens = tokenize(skill.description)
    let score = 0
    for (const term of promptTokens) {
      const frequency = documentFrequencies.get(term) ?? 0
      if (frequency === 0) {
        continue
      }
      const inverseDocumentFrequency = Math.log((totalDocuments + 1) / (frequency + 1))
      const termFrequency = descriptionTokens.filter((token) => token === term).length / descriptionTokens.length
      score += inverseDocumentFrequency * termFrequency
    }
    scores.set(skill.id, score)
  }

  return scores
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

function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM selection response did not contain valid JSON')
  }
  return text.slice(start, end + 1)
}

function parseLlmSkillSelectionResponse(text: string): LlmSkillSelectionResponse {
  const parsed = JSON.parse(extractJsonObject(text.trim())) as Partial<LlmSkillSelectionResponse>
  if (!Array.isArray(parsed.selections)) {
    throw new Error('LLM selection response did not include a selections array')
  }

  return {
    selections: parsed.selections
      .filter((selection): selection is { id: string; reason?: string } => typeof selection?.id === 'string')
      .map((selection) => ({
        id: selection.id,
        reason: typeof selection.reason === 'string' ? selection.reason : undefined
      }))
  }
}

async function invokeLlmSkillSelection(request: LlmSkillSelectionRequest): Promise<LlmSkillSelectionResponse> {
  if (!request.model) {
    throw new Error('No model available for LLM skill selection')
  }

  const completionRequest: ChatCompletionCreateParams = {
    model: request.model,
    messages: [
      { role: 'system', content: buildLlmSelectionSystemPrompt(request.mode) },
      { role: 'user', content: buildLlmSelectionUserPrompt(request) }
    ],
    temperature: 0,
    max_tokens: 600,
    stream: false
  }

  const { response } = await chatCompletionService.processCompletion(completionRequest)
  const messageContent = response.choices[0]?.message?.content
  const text = typeof messageContent === 'string' ? messageContent : ''
  if (!text.trim()) {
    throw new Error('LLM selection response was empty')
  }

  return parseLlmSkillSelectionResponse(text)
}

function getSelectionFailureReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'unknown LLM routing error'
}

export class MainSkillSelector {
  private readonly config: SkillGlobalConfig
  private readonly resolver: MainEmbeddingResolver
  private readonly registry: SkillRegistry
  private readonly activeModel?: string
  private readonly topK: number
  private readonly similarityThreshold: number

  constructor(config: SkillGlobalConfig, registry: SkillRegistry, activeModel?: string) {
    this.config = config
    this.registry = registry
    this.activeModel = activeModel
    this.topK = getSkillMethodTopK(config)
    this.similarityThreshold = getSkillMethodSimilarityThreshold(config)
    this.resolver = new MainEmbeddingResolver(getSkillMethodEmbeddingModelId(config))
  }

  async select(prompt: string, skills: SkillDescriptor[]): Promise<SkillSelectorResult[]> {
    if (skills.length === 0 || this.topK === 0) {
      return []
    }

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
    const promptVector = await this.resolver.embed(prompt)
    const scored = await this.scoreByEmbedding(promptVector, skills)

    return scored
      .filter((result) => result.score >= this.similarityThreshold)
      .sort((left, right) => right.score - left.score)
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
    const promptVector = await this.resolver.embed(prompt)
    const scored = await this.scoreByEmbedding(promptVector, skills)

    return scored
      .filter((result) => result.score >= this.similarityThreshold)
      .sort((left, right) => right.score - left.score)
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
    const promptVector = await this.resolver.embed(prompt)
    const bm25Map = computeBm25Scores(prompt, skills)
    const bm25Ranked = [...skills].sort((left, right) => (bm25Map.get(right.id) ?? 0) - (bm25Map.get(left.id) ?? 0))
    const denseScored = await this.scoreByEmbedding(promptVector, skills)
    const denseRanked = [...denseScored].sort((left, right) => right.score - left.score)

    const bm25Rank = new Map(bm25Ranked.map((skill, index) => [skill.id, index + 1]))
    const denseRank = new Map(denseRanked.map((result, index) => [result.skill.id, index + 1]))

    return skills
      .map((skill) => {
        const bm25Position = bm25Rank.get(skill.id) ?? skills.length + 1
        const densePosition = denseRank.get(skill.id) ?? skills.length + 1
        const reciprocalRankFusion = 1 / (60 + bm25Position) + 1 / (60 + densePosition)
        return { skill, reciprocalRankFusion }
      })
      .sort((left, right) => right.reciprocalRankFusion - left.reciprocalRankFusion)
      .slice(0, this.topK)
      .map(({ skill, reciprocalRankFusion }) => ({
        skill,
        score: reciprocalRankFusion,
        matchedKeywords: this.registry.getMatchedTokens(skill, prompt),
        selectionReason: `Hybrid BM25+dense (RRF): ${reciprocalRankFusion.toFixed(3)}`,
        activationMethod: SkillSelectionMethod.HYBRID
      }))
  }

  private async selectByTwoStage(prompt: string, skills: SkillDescriptor[]): Promise<SkillSelectorResult[]> {
    const bm25Map = computeBm25Scores(prompt, skills)
    const bm25TopK = [...skills]
      .sort((left, right) => (bm25Map.get(right.id) ?? 0) - (bm25Map.get(left.id) ?? 0))
      .slice(0, this.topK)
    const triggerMatches = skills.filter((skill) => this.registry.matchesTriggers(skill, prompt))
    const seen = new Set<string>()
    const candidates: SkillDescriptor[] = []

    for (const skill of [...triggerMatches, ...bm25TopK]) {
      if (seen.has(skill.id)) {
        continue
      }
      seen.add(skill.id)
      candidates.push(skill)
    }

    if (candidates.length === 0) {
      return []
    }

    const promptVector = await this.resolver.embed(prompt)
    const reranked = await this.scoreByEmbedding(promptVector, candidates)

    return reranked
      .filter((result) => result.score >= this.similarityThreshold)
      .sort((left, right) => right.score - left.score)
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

    const model = getSkillMethodLlmModelId(this.config) ?? this.activeModel
    if (!model) {
      return this.selectByEmbeddingWithOverride(
        prompt,
        skills,
        activationMethod,
        `LLM ${mode} fallback to embedding: no routing model available`
      )
    }

    try {
      const response = await invokeLlmSkillSelection({
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
        .filter((selection, index, list) => list.findIndex((entry) => entry.id === selection.id) === index)
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
      logger.warn(`LLM skill ${mode} failed in main process, falling back to embedding`, {
        error: message,
        selectionMethod: activationMethod,
        configuredModelId: getSkillMethodLlmModelId(this.config),
        activeModelId: this.activeModel
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
    const promptVector = await this.resolver.embed(prompt)
    const candidateLimit = Math.min(DEFAULT_LLM_SELECTION_CANDIDATE_LIMIT, Math.max(this.topK * 4, this.topK))

    return (await this.scoreByEmbedding(promptVector, skills))
      .filter((candidate) => candidate.score >= this.similarityThreshold)
      .sort((left, right) => right.score - left.score)
      .slice(0, candidateLimit)
  }

  private async scoreByEmbedding(
    promptVector: number[],
    skills: SkillDescriptor[]
  ): Promise<Array<{ skill: SkillDescriptor; score: number }>> {
    return Promise.all(
      skills.map(async (skill) => {
        const descriptionVector = await this.resolver.embed(skill.description)
        const score = this.resolver.cosineSimilarity(promptVector, descriptionVector)
        return { skill, score }
      })
    )
  }
}
