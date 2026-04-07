// src/renderer/src/services/skills/skillSelector.ts
import { loggerService } from '@logger'
import type { SkillGlobalConfig } from '@renderer/types/skillConfig'
import { SkillSelectionMethod } from '@renderer/types/skillConfig'

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

// ─────────────────────────────────────────────────────────────────────────────
// BM25 helpers (simplified – no k1/b tuning)
// ─────────────────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(Boolean)
}

function computeBm25Scores(prompt: string, skills: SkillDescriptor[]): Map<string, number> {
  const promptTokens = tokenize(prompt)
  const N = skills.length

  // document-frequency per term
  const df = new Map<string, number>()
  for (const skill of skills) {
    const docTokens = new Set(tokenize(skill.description))
    for (const t of docTokens) {
      df.set(t, (df.get(t) ?? 0) + 1)
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
      const tf = docTokens.filter((t) => t === term).length / docTokens.length
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
  private config: SkillGlobalConfig
  private resolver: EmbeddingResolver
  private registry: SkillRegistry

  constructor(config: SkillGlobalConfig, resolver?: EmbeddingResolver, registry?: SkillRegistry) {
    this.config = config
    this.resolver = resolver ?? new EmbeddingResolver(config.embeddingModelId)
    // Accept an injected registry (useful for testing); default to the module-level singleton
    this.registry = registry ?? defaultRegistry
  }

  async select(prompt: string, skills: SkillDescriptor[]): Promise<SkillSelectorResult[]> {
    if (skills.length === 0 || this.config.topK === 0) return []

    switch (this.config.selectionMethod) {
      case SkillSelectionMethod.EMBEDDING:
        return this.selectByEmbedding(prompt, skills)

      case SkillSelectionMethod.HYBRID:
        return this.selectByHybrid(prompt, skills)

      case SkillSelectionMethod.TWO_STAGE:
        return this.selectByTwoStage(prompt, skills)

      case SkillSelectionMethod.LLM_ROUTER:
        logger.warn('LLM_ROUTER not yet implemented, falling back to EMBEDDING')
        return this.selectByEmbeddingWithOverride(
          prompt,
          skills,
          SkillSelectionMethod.LLM_ROUTER,
          'LLM routing (fallback to embedding)'
        )

      case SkillSelectionMethod.LLM_DELEGATED:
        logger.warn('LLM_DELEGATED not yet implemented, falling back to EMBEDDING')
        return this.selectByEmbeddingWithOverride(
          prompt,
          skills,
          SkillSelectionMethod.LLM_DELEGATED,
          'LLM delegated (fallback to embedding)'
        )

      default:
        return this.selectByEmbedding(prompt, skills)
    }
  }

  // ── EMBEDDING ─────────────────────────────────────────────────────────────

  private async selectByEmbedding(prompt: string, skills: SkillDescriptor[]): Promise<SkillSelectorResult[]> {
    const promptVec = await this.resolver.embed(prompt)
    const scored = await this.scoreByEmbedding(promptVec, skills)

    return scored
      .filter((s) => s.score >= this.config.similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.topK)
      .map((s) => ({
        skill: s.skill,
        score: s.score,
        matchedKeywords: [],
        selectionReason: `Semantic similarity: ${s.score.toFixed(2)}`,
        activationMethod: SkillSelectionMethod.EMBEDDING
      }))
  }

  /** Same logic as EMBEDDING but with a custom activationMethod + selectionReason (LLM fallbacks) */
  private async selectByEmbeddingWithOverride(
    prompt: string,
    skills: SkillDescriptor[],
    activationMethod: SkillSelectionMethod,
    selectionReason: string
  ): Promise<SkillSelectorResult[]> {
    const promptVec = await this.resolver.embed(prompt)
    const scored = await this.scoreByEmbedding(promptVec, skills)

    return scored
      .filter((s) => s.score >= this.config.similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.topK)
      .map((s) => ({
        skill: s.skill,
        score: s.score,
        matchedKeywords: [],
        selectionReason,
        activationMethod
      }))
  }

  // ── HYBRID (BM25 + dense via RRF) ─────────────────────────────────────────

  private async selectByHybrid(prompt: string, skills: SkillDescriptor[]): Promise<SkillSelectorResult[]> {
    const promptVec = await this.resolver.embed(prompt)

    // BM25 ranking
    const bm25Map = computeBm25Scores(prompt, skills)
    const bm25Ranked = [...skills].sort((a, b) => (bm25Map.get(b.id) ?? 0) - (bm25Map.get(a.id) ?? 0))

    // Dense ranking
    const denseScored = await this.scoreByEmbedding(promptVec, skills)
    const denseRanked = [...denseScored].sort((a, b) => b.score - a.score)

    // Build rank indexes (1-based)
    const bm25Rank = new Map(bm25Ranked.map((s, i) => [s.id, i + 1]))
    const denseRank = new Map(denseRanked.map((s, i) => [s.skill.id, i + 1]))
    const denseScoreMap = new Map(denseScored.map((s) => [s.skill.id, s.score]))

    // RRF fusion
    const rrfScores = skills.map((skill) => {
      const rb = bm25Rank.get(skill.id) ?? skills.length + 1
      const rd = denseRank.get(skill.id) ?? skills.length + 1
      const rrf = 1 / (60 + rb) + 1 / (60 + rd)
      return { skill, rrf, denseScore: denseScoreMap.get(skill.id) ?? 0 }
    })

    // HYBRID uses RRF ranking rather than a hard similarity threshold; topK limits results.
    // RRF scores are always positive (1/(60+rank)), so no hard threshold is applied —
    // the fusion ranking itself demotes irrelevant skills to the bottom, and topK caps the output.
    return rrfScores
      .sort((a, b) => b.rrf - a.rrf)
      .slice(0, this.config.topK)
      .map(({ skill, rrf }) => ({
        skill,
        score: rrf,
        matchedKeywords: this.registry.getMatchedTokens(skill, prompt),
        selectionReason: `Hybrid BM25+dense (RRF): ${rrf.toFixed(3)}`,
        activationMethod: SkillSelectionMethod.HYBRID
      }))
  }

  // ── TWO_STAGE ─────────────────────────────────────────────────────────────

  private async selectByTwoStage(prompt: string, skills: SkillDescriptor[]): Promise<SkillSelectorResult[]> {
    // Stage 1: trigger-pattern candidates + BM25 top-K
    const bm25Map = computeBm25Scores(prompt, skills)
    const bm25TopK = [...skills]
      .sort((a, b) => (bm25Map.get(b.id) ?? 0) - (bm25Map.get(a.id) ?? 0))
      .slice(0, this.config.topK)

    const triggerMatches = skills.filter((s) => this.registry.matchesTriggers(s, prompt))

    // Union of trigger matches and BM25 top-K (deduplicated by id)
    const seen = new Set<string>()
    const candidates: SkillDescriptor[] = []
    for (const s of [...triggerMatches, ...bm25TopK]) {
      if (!seen.has(s.id)) {
        seen.add(s.id)
        candidates.push(s)
      }
    }

    if (candidates.length === 0) return []

    // Stage 2: re-rank candidates by embedding similarity
    const promptVec = await this.resolver.embed(prompt)
    const reRanked = await this.scoreByEmbedding(promptVec, candidates)

    return reRanked
      .filter((s) => s.score >= this.config.similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.topK)
      .map((s) => ({
        skill: s.skill,
        score: s.score,
        matchedKeywords: this.registry.getMatchedTokens(s.skill, prompt),
        selectionReason: `Two-stage (keyword→embedding): ${s.score.toFixed(2)}`,
        activationMethod: SkillSelectionMethod.TWO_STAGE
      }))
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  private async scoreByEmbedding(
    promptVec: number[],
    skills: SkillDescriptor[]
  ): Promise<Array<{ skill: SkillDescriptor; score: number }>> {
    const results = await Promise.all(
      skills.map(async (skill) => {
        const descVec = await this.resolver.embed(skill.description)
        const score = this.resolver.cosineSimilarity(promptVec, descVec)
        return { skill, score }
      })
    )
    return results
  }
}
