import { loggerService } from '@logger'
import type { SkillGlobalConfig } from '@types'
import {
  getSkillMethodLlmModelId,
  getSkillMethodSimilarityThreshold,
  getSkillMethodTopK,
  SkillSelectionMethod
} from '@types'

import type { SkillDescriptor, SkillRegistry } from './skillRegistry'

const logger = loggerService.withContext('SkillSelectorCore')

export interface EmbeddingResolverLike {
  embed: (text: string) => Promise<number[]>
  embedBatch: (texts: string[]) => Promise<number[][]>
  cosineSimilarity: (a: number[], b: number[]) => number
}

export interface SkillSelectorResult {
  skill: SkillDescriptor
  score: number
  matchedKeywords: string[]
  selectionReason: string
  activationMethod: SkillSelectionMethod
}

export type SkillSelectorMode = 'router' | 'delegated'

type LlmSkillSelectionCandidate = {
  id: string
  name: string
  description: string
  similarityScore: number
  matchedKeywords: string[]
}

export type LlmSkillSelectionChoice = {
  id: string
  reason?: string
}

export type LlmSkillSelectionResponse = {
  selections: LlmSkillSelectionChoice[]
}

export type LlmSkillSelectionRequest<TModel> = {
  mode: SkillSelectorMode
  prompt: string
  candidates: LlmSkillSelectionCandidate[]
  model?: TModel
}

export type LlmSelectionInvoker<TModel> = (
  request: LlmSkillSelectionRequest<TModel>
) => Promise<LlmSkillSelectionResponse>
export type ModelResolver<TModel> = (modelOrId?: TModel | string) => TModel | undefined

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

function getSelectionFailureReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'unknown LLM routing error'
}

export class SkillSelectorCore<TModel = string> {
  protected readonly config: SkillGlobalConfig
  protected readonly resolver: EmbeddingResolverLike
  protected readonly registry: SkillRegistry
  protected readonly llmSelectionInvoker: LlmSelectionInvoker<TModel>
  protected readonly resolveModelReference: ModelResolver<TModel>
  protected readonly activeModel?: TModel
  protected readonly topK: number
  protected readonly similarityThreshold: number

  constructor(params: {
    config: SkillGlobalConfig
    resolver: EmbeddingResolverLike
    registry: SkillRegistry
    llmSelectionInvoker: LlmSelectionInvoker<TModel>
    resolveModelReference: ModelResolver<TModel>
    activeModel?: TModel
  }) {
    this.config = params.config
    this.resolver = params.resolver
    this.registry = params.registry
    this.llmSelectionInvoker = params.llmSelectionInvoker
    this.resolveModelReference = params.resolveModelReference
    this.activeModel = params.activeModel
    this.topK = getSkillMethodTopK(params.config)
    this.similarityThreshold = getSkillMethodSimilarityThreshold(params.config)
  }

  async select(prompt: string, skills: SkillDescriptor[]): Promise<SkillSelectorResult[]> {
    if (skills.length === 0 || this.topK === 0) {
      return []
    }

    switch (this.config.selectionMethod) {
      case SkillSelectionMethod.KEYWORD:
        return this.selectByKeyword(prompt, skills)
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
        return this.selectByKeyword(prompt, skills)
    }
  }

  private selectByKeyword(prompt: string, skills: SkillDescriptor[]): SkillSelectorResult[] {
    const triggerMatches = skills.filter((skill) => this.registry.matchesTriggers(skill, prompt))
    const bm25Map = computeBm25Scores(prompt, skills)

    const seen = new Set<string>()
    const ranked: Array<{ skill: SkillDescriptor; score: number; fromTrigger: boolean }> = []

    for (const skill of triggerMatches) {
      if (seen.has(skill.id)) continue
      seen.add(skill.id)
      ranked.push({ skill, score: bm25Map.get(skill.id) ?? 0, fromTrigger: true })
    }

    const bm25Sorted = [...skills]
      .filter((s) => !seen.has(s.id))
      .sort((a, b) => (bm25Map.get(b.id) ?? 0) - (bm25Map.get(a.id) ?? 0))

    for (const skill of bm25Sorted) {
      if (ranked.length >= this.topK) break
      const score = bm25Map.get(skill.id) ?? 0
      if (score <= 0) break
      seen.add(skill.id)
      ranked.push({ skill, score, fromTrigger: false })
    }

    return ranked.slice(0, this.topK).map(({ skill, score, fromTrigger }) => ({
      skill,
      score,
      matchedKeywords: this.registry.getMatchedTokens(skill, prompt),
      selectionReason: fromTrigger ? `Trigger pattern match` : `BM25 keyword score: ${score.toFixed(3)}`,
      activationMethod: SkillSelectionMethod.KEYWORD
    }))
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
    const denseScoreMap = new Map(denseScored.map((result) => [result.skill.id, result.score]))

    return skills
      .map((skill) => {
        const bm25Position = bm25Rank.get(skill.id) ?? skills.length + 1
        const densePosition = denseRank.get(skill.id) ?? skills.length + 1
        const reciprocalRankFusion = 1 / (60 + bm25Position) + 1 / (60 + densePosition)

        return {
          skill,
          reciprocalRankFusion,
          denseScore: denseScoreMap.get(skill.id) ?? 0
        }
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

    const model = this.resolveModelReference(getSkillMethodLlmModelId(this.config)) ?? this.activeModel
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
        activeModelId: String(this.activeModel)
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
    const descriptions = skills.map((s) => s.description)
    const vectors = await this.resolver.embedBatch(descriptions)
    return skills.map((skill, i) => ({
      skill,
      score: this.resolver.cosineSimilarity(promptVector, vectors[i])
    }))
  }
}
