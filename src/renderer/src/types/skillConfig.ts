/**
 * Skill selection and context management configuration types.
 * Controls how skills are matched to user prompts and how their content
 * is injected into the LLM context window before each request.
 */
export enum SkillSelectionMethod {
  LLM_DELEGATED = 'llm_delegated',
  EMBEDDING = 'embedding',
  HYBRID = 'hybrid',
  LLM_ROUTER = 'llm_router',
  TWO_STAGE = 'two_stage'
}

export enum ContextManagementMethod {
  FULL_INJECTION = 'full_injection',
  PREFIX_CACHE_AWARE = 'prefix_cache_aware',
  CHUNKED_RAG = 'chunked_rag',
  SUMMARIZED = 'summarized',
  PROGRESSIVE = 'progressive'
}

export interface SkillGlobalConfig {
  selectionMethod: SkillSelectionMethod
  embeddingModelId?: string // undefined → use fastembed
  similarityThreshold: number
  topK: number
  contextManagementMethod: ContextManagementMethod
  maxSkillTokens: number
}

/** Per-agent override — all fields optional; undefined means inherit global */
export interface AgentSkillConfigOverride {
  selectionMethod?: SkillSelectionMethod
  embeddingModelId?: string
  similarityThreshold?: number
  topK?: number
  contextManagementMethod?: ContextManagementMethod
  maxSkillTokens?: number
}

export const DEFAULT_SKILL_CONFIG: SkillGlobalConfig = {
  selectionMethod: SkillSelectionMethod.EMBEDDING,
  similarityThreshold: 0.35,
  topK: 3,
  contextManagementMethod: ContextManagementMethod.PREFIX_CACHE_AWARE,
  maxSkillTokens: 4096
}

/** Merge agent override on top of global config */
export function resolveSkillConfig(
  global: SkillGlobalConfig,
  agentOverride?: AgentSkillConfigOverride
): SkillGlobalConfig {
  if (!agentOverride) return global
  return {
    selectionMethod: agentOverride.selectionMethod ?? global.selectionMethod,
    embeddingModelId: agentOverride.embeddingModelId ?? global.embeddingModelId,
    similarityThreshold: agentOverride.similarityThreshold ?? global.similarityThreshold,
    topK: agentOverride.topK ?? global.topK,
    contextManagementMethod: agentOverride.contextManagementMethod ?? global.contextManagementMethod,
    maxSkillTokens: agentOverride.maxSkillTokens ?? global.maxSkillTokens
  }
}
