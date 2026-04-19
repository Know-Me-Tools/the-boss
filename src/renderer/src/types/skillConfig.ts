import * as z from 'zod'

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

export interface EmbeddingSkillMethodConfig {
  embeddingModelId?: string
  similarityThreshold: number
  topK: number
}

export interface HybridSkillMethodConfig {
  embeddingModelId?: string
  topK: number
}

export interface TwoStageSkillMethodConfig {
  embeddingModelId?: string
  similarityThreshold: number
  topK: number
}

export interface LlmRouterSkillMethodConfig {
  llmModelId?: string
  embeddingModelId?: string
  similarityThreshold: number
  topK: number
}

export interface LlmDelegatedSkillMethodConfig {
  llmModelId?: string
  embeddingModelId?: string
  similarityThreshold: number
  topK: number
}

export type SkillMethodConfigMap = {
  [SkillSelectionMethod.EMBEDDING]: EmbeddingSkillMethodConfig
  [SkillSelectionMethod.HYBRID]: HybridSkillMethodConfig
  [SkillSelectionMethod.TWO_STAGE]: TwoStageSkillMethodConfig
  [SkillSelectionMethod.LLM_ROUTER]: LlmRouterSkillMethodConfig
  [SkillSelectionMethod.LLM_DELEGATED]: LlmDelegatedSkillMethodConfig
}

export type SkillMethodOverrideMap = Partial<{
  [SkillSelectionMethod.EMBEDDING]: Partial<EmbeddingSkillMethodConfig>
  [SkillSelectionMethod.HYBRID]: Partial<HybridSkillMethodConfig>
  [SkillSelectionMethod.TWO_STAGE]: Partial<TwoStageSkillMethodConfig>
  [SkillSelectionMethod.LLM_ROUTER]: Partial<LlmRouterSkillMethodConfig>
  [SkillSelectionMethod.LLM_DELEGATED]: Partial<LlmDelegatedSkillMethodConfig>
}>

export interface SkillGlobalConfig {
  selectionMethod: SkillSelectionMethod
  contextManagementMethod: ContextManagementMethod
  maxSkillTokens: number
  selectedSkillIds?: string[]
  methods: SkillMethodConfigMap
}

/**
 * Partial override that can be applied at agent, session, or conversation scope.
 *
 * Legacy flat fields remain readable for backward compatibility and are normalized
 * into the per-method buckets when merging/resolving config.
 */
export interface SkillConfigOverride {
  selectionMethod?: SkillSelectionMethod
  contextManagementMethod?: ContextManagementMethod
  maxSkillTokens?: number
  selectedSkillIds?: string[]
  methods?: SkillMethodOverrideMap

  // Legacy flat fields
  llmModelId?: string
  embeddingModelId?: string
  similarityThreshold?: number
  topK?: number
}

/** @deprecated Prefer SkillConfigOverride. */
export type AgentSkillConfigOverride = SkillConfigOverride

const skillMethodEntries = [
  SkillSelectionMethod.EMBEDDING,
  SkillSelectionMethod.HYBRID,
  SkillSelectionMethod.TWO_STAGE,
  SkillSelectionMethod.LLM_ROUTER,
  SkillSelectionMethod.LLM_DELEGATED
] as const

const METHOD_FIELDS = {
  [SkillSelectionMethod.EMBEDDING]: ['embeddingModelId', 'similarityThreshold', 'topK'],
  [SkillSelectionMethod.HYBRID]: ['embeddingModelId', 'topK'],
  [SkillSelectionMethod.TWO_STAGE]: ['embeddingModelId', 'similarityThreshold', 'topK'],
  [SkillSelectionMethod.LLM_ROUTER]: ['llmModelId', 'embeddingModelId', 'similarityThreshold', 'topK'],
  [SkillSelectionMethod.LLM_DELEGATED]: ['llmModelId', 'embeddingModelId', 'similarityThreshold', 'topK']
} as const

export const DEFAULT_SKILL_METHOD_CONFIGS: SkillMethodConfigMap = {
  [SkillSelectionMethod.EMBEDDING]: {
    similarityThreshold: 0.35,
    topK: 3
  },
  [SkillSelectionMethod.HYBRID]: {
    topK: 3
  },
  [SkillSelectionMethod.TWO_STAGE]: {
    similarityThreshold: 0.35,
    topK: 3
  },
  [SkillSelectionMethod.LLM_ROUTER]: {
    similarityThreshold: 0.35,
    topK: 3
  },
  [SkillSelectionMethod.LLM_DELEGATED]: {
    similarityThreshold: 0.35,
    topK: 3
  }
}

export const DEFAULT_SKILL_CONFIG: SkillGlobalConfig = {
  selectionMethod: SkillSelectionMethod.EMBEDDING,
  contextManagementMethod: ContextManagementMethod.PREFIX_CACHE_AWARE,
  maxSkillTokens: 4096,
  methods: cloneSkillMethodConfigs(DEFAULT_SKILL_METHOD_CONFIGS)
}

const EmbeddingSkillMethodConfigSchema = z.object({
  embeddingModelId: z.string().optional(),
  similarityThreshold: z.number(),
  topK: z.number()
})

const HybridSkillMethodConfigSchema = z.object({
  embeddingModelId: z.string().optional(),
  topK: z.number()
})

const TwoStageSkillMethodConfigSchema = z.object({
  embeddingModelId: z.string().optional(),
  similarityThreshold: z.number(),
  topK: z.number()
})

const LlmRouterSkillMethodConfigSchema = z.object({
  llmModelId: z.string().optional(),
  embeddingModelId: z.string().optional(),
  similarityThreshold: z.number(),
  topK: z.number()
})

const LlmDelegatedSkillMethodConfigSchema = z.object({
  llmModelId: z.string().optional(),
  embeddingModelId: z.string().optional(),
  similarityThreshold: z.number(),
  topK: z.number()
})

export const SkillMethodOverrideMapSchema = z
  .object({
    [SkillSelectionMethod.EMBEDDING]: EmbeddingSkillMethodConfigSchema.partial().optional(),
    [SkillSelectionMethod.HYBRID]: HybridSkillMethodConfigSchema.partial().optional(),
    [SkillSelectionMethod.TWO_STAGE]: TwoStageSkillMethodConfigSchema.partial().optional(),
    [SkillSelectionMethod.LLM_ROUTER]: LlmRouterSkillMethodConfigSchema.partial().optional(),
    [SkillSelectionMethod.LLM_DELEGATED]: LlmDelegatedSkillMethodConfigSchema.partial().optional()
  })
  .partial()

export const SkillConfigOverrideSchema = z
  .object({
    selectionMethod: z.nativeEnum(SkillSelectionMethod).optional(),
    contextManagementMethod: z.nativeEnum(ContextManagementMethod).optional(),
    maxSkillTokens: z.number().optional(),
    selectedSkillIds: z.array(z.string()).optional(),
    methods: SkillMethodOverrideMapSchema.optional(),
    llmModelId: z.string().optional(),
    embeddingModelId: z.string().optional(),
    similarityThreshold: z.number().optional(),
    topK: z.number().optional()
  })
  .partial()

export const SkillGlobalConfigSchema = z.object({
  selectionMethod: z.nativeEnum(SkillSelectionMethod),
  contextManagementMethod: z.nativeEnum(ContextManagementMethod),
  maxSkillTokens: z.number(),
  selectedSkillIds: z.array(z.string()).optional(),
  methods: z.object({
    [SkillSelectionMethod.EMBEDDING]: EmbeddingSkillMethodConfigSchema,
    [SkillSelectionMethod.HYBRID]: HybridSkillMethodConfigSchema,
    [SkillSelectionMethod.TWO_STAGE]: TwoStageSkillMethodConfigSchema,
    [SkillSelectionMethod.LLM_ROUTER]: LlmRouterSkillMethodConfigSchema,
    [SkillSelectionMethod.LLM_DELEGATED]: LlmDelegatedSkillMethodConfigSchema
  })
})

export const LLM_SELECTION_METHODS = new Set<SkillSelectionMethod>([
  SkillSelectionMethod.LLM_ROUTER,
  SkillSelectionMethod.LLM_DELEGATED
])

export const SIMILARITY_THRESHOLD_METHODS = new Set<SkillSelectionMethod>([
  SkillSelectionMethod.EMBEDDING,
  SkillSelectionMethod.TWO_STAGE,
  SkillSelectionMethod.LLM_ROUTER,
  SkillSelectionMethod.LLM_DELEGATED
])

export function cloneSkillMethodConfigs(configs: SkillMethodConfigMap): SkillMethodConfigMap {
  return {
    [SkillSelectionMethod.EMBEDDING]: { ...configs[SkillSelectionMethod.EMBEDDING] },
    [SkillSelectionMethod.HYBRID]: { ...configs[SkillSelectionMethod.HYBRID] },
    [SkillSelectionMethod.TWO_STAGE]: { ...configs[SkillSelectionMethod.TWO_STAGE] },
    [SkillSelectionMethod.LLM_ROUTER]: { ...configs[SkillSelectionMethod.LLM_ROUTER] },
    [SkillSelectionMethod.LLM_DELEGATED]: { ...configs[SkillSelectionMethod.LLM_DELEGATED] }
  }
}

export function isLlmSelectionMethod(method: SkillSelectionMethod): boolean {
  return LLM_SELECTION_METHODS.has(method)
}

export function usesSimilarityThreshold(method: SkillSelectionMethod): boolean {
  return SIMILARITY_THRESHOLD_METHODS.has(method)
}

export function getSkillMethodConfig<M extends SkillSelectionMethod>(
  config: SkillGlobalConfig,
  method: M
): SkillMethodConfigMap[M] {
  return config.methods[method]
}

export function getSelectedSkillMethodConfig(config: SkillGlobalConfig): SkillMethodConfigMap[SkillSelectionMethod] {
  return getSkillMethodConfig(config, config.selectionMethod)
}

export function getSkillMethodTopK(config: SkillGlobalConfig, method = config.selectionMethod): number {
  return getSkillMethodConfig(config, method).topK
}

export function getSkillMethodSimilarityThreshold(config: SkillGlobalConfig, method = config.selectionMethod): number {
  const methodConfig = getSkillMethodConfig(config, method)
  return 'similarityThreshold' in methodConfig
    ? methodConfig.similarityThreshold
    : DEFAULT_SKILL_METHOD_CONFIGS[SkillSelectionMethod.EMBEDDING].similarityThreshold
}

export function getSkillMethodEmbeddingModelId(
  config: SkillGlobalConfig,
  method = config.selectionMethod
): string | undefined {
  const methodConfig = getSkillMethodConfig(config, method)
  return 'embeddingModelId' in methodConfig ? methodConfig.embeddingModelId : undefined
}

export function getSkillMethodLlmModelId(
  config: SkillGlobalConfig,
  method = config.selectionMethod
): string | undefined {
  const methodConfig = getSkillMethodConfig(config, method)
  return 'llmModelId' in methodConfig ? methodConfig.llmModelId : undefined
}

export function normalizeSkillConfig(value?: SkillGlobalConfig | SkillConfigOverride | null): SkillGlobalConfig {
  return applySkillConfigOverride(DEFAULT_SKILL_CONFIG, value)
}

export function applySkillConfigOverride(
  base: SkillGlobalConfig,
  override?: SkillConfigOverride | SkillGlobalConfig | null
): SkillGlobalConfig {
  if (!override) {
    return base
  }

  const next: SkillGlobalConfig = {
    selectionMethod: override.selectionMethod ?? base.selectionMethod,
    contextManagementMethod: override.contextManagementMethod ?? base.contextManagementMethod,
    maxSkillTokens: override.maxSkillTokens ?? base.maxSkillTokens,
    selectedSkillIds:
      override.selectedSkillIds !== undefined
        ? normalizeSelectedSkillIds(override.selectedSkillIds)
        : base.selectedSkillIds,
    methods: cloneSkillMethodConfigs(base.methods)
  }

  applyLegacyFields(next.methods, override)

  if (override.methods) {
    for (const method of skillMethodEntries) {
      const methodOverride = override.methods[method]
      if (methodOverride) {
        mergeSkillMethodConfig(next.methods, method, methodOverride)
      }
    }
  }

  return next
}

/** Merge one or more scoped overrides on top of global config. Later overrides win. */
export function resolveSkillConfig(
  global: SkillGlobalConfig | SkillConfigOverride,
  ...overrides: Array<SkillConfigOverride | undefined | null>
): SkillGlobalConfig {
  const normalizedGlobal = normalizeSkillConfig(global)

  if (overrides.every((override) => !override)) {
    return normalizedGlobal
  }

  let selectedSkillIds = normalizedGlobal.selectedSkillIds
  const resolved = overrides.reduce<SkillGlobalConfig>((resolved, override) => {
    if (override?.selectedSkillIds !== undefined) {
      selectedSkillIds = intersectSelectedSkillIds(selectedSkillIds, override.selectedSkillIds)
    }

    return applySkillConfigOverride(resolved, override)
  }, normalizedGlobal)

  return {
    ...resolved,
    selectedSkillIds
  }
}

export function deriveSkillConfigOverride(
  base: SkillGlobalConfig | SkillConfigOverride,
  next: SkillGlobalConfig | SkillConfigOverride
): SkillConfigOverride | undefined {
  const normalizedBase = normalizeSkillConfig(base)
  const normalizedNext = normalizeSkillConfig(next)
  const override: SkillConfigOverride = {}

  if (normalizedNext.selectionMethod !== normalizedBase.selectionMethod) {
    override.selectionMethod = normalizedNext.selectionMethod
  }
  if (normalizedNext.contextManagementMethod !== normalizedBase.contextManagementMethod) {
    override.contextManagementMethod = normalizedNext.contextManagementMethod
  }
  if (normalizedNext.maxSkillTokens !== normalizedBase.maxSkillTokens) {
    override.maxSkillTokens = normalizedNext.maxSkillTokens
  }
  if (!selectedSkillIdsEqual(normalizedNext.selectedSkillIds, normalizedBase.selectedSkillIds)) {
    override.selectedSkillIds = normalizedNext.selectedSkillIds
  }

  for (const method of skillMethodEntries) {
    const fields = METHOD_FIELDS[method]
    for (const field of fields) {
      if (normalizedNext.methods[method][field] !== normalizedBase.methods[method][field]) {
        override.methods ??= {}
        override.methods[method] = {
          ...override.methods[method],
          [field]: normalizedNext.methods[method][field]
        } as SkillMethodOverrideMap[typeof method]
      }
    }
  }

  return hasSkillConfigOverride(override) ? override : undefined
}

export function hasSkillConfigOverride(override?: SkillConfigOverride | null): boolean {
  if (!override) {
    return false
  }

  if (
    override.selectionMethod !== undefined ||
    override.contextManagementMethod !== undefined ||
    override.maxSkillTokens !== undefined ||
    override.selectedSkillIds !== undefined ||
    override.llmModelId !== undefined ||
    override.embeddingModelId !== undefined ||
    override.similarityThreshold !== undefined ||
    override.topK !== undefined
  ) {
    return true
  }

  return skillMethodEntries.some((method) => {
    const methodOverride = override.methods?.[method]
    return !!methodOverride && Object.values(methodOverride).some((value) => value !== undefined)
  })
}

function normalizeSelectedSkillIds(selectedSkillIds: string[]): string[] {
  return Array.from(new Set(selectedSkillIds))
}

function intersectSelectedSkillIds(current: string[] | undefined, next: string[]): string[] {
  const normalizedNext = normalizeSelectedSkillIds(next)

  if (current === undefined) {
    return normalizedNext
  }

  if (current.length === 0 || normalizedNext.length === 0) {
    return []
  }

  const nextSet = new Set(normalizedNext)
  return current.filter((skillId) => nextSet.has(skillId))
}

function selectedSkillIdsEqual(left?: string[], right?: string[]): boolean {
  if (left === right) {
    return true
  }

  if (left === undefined || right === undefined) {
    return left === right
  }

  if (left.length !== right.length) {
    return false
  }

  return left.every((skillId, index) => skillId === right[index])
}

function applyLegacyFields(methods: SkillMethodConfigMap, override: SkillConfigOverride | SkillGlobalConfig) {
  if ('llmModelId' in override && override.llmModelId !== undefined) {
    methods[SkillSelectionMethod.LLM_ROUTER].llmModelId = override.llmModelId
    methods[SkillSelectionMethod.LLM_DELEGATED].llmModelId = override.llmModelId
  }

  if ('embeddingModelId' in override && override.embeddingModelId !== undefined) {
    methods[SkillSelectionMethod.EMBEDDING].embeddingModelId = override.embeddingModelId
    methods[SkillSelectionMethod.HYBRID].embeddingModelId = override.embeddingModelId
    methods[SkillSelectionMethod.TWO_STAGE].embeddingModelId = override.embeddingModelId
    methods[SkillSelectionMethod.LLM_ROUTER].embeddingModelId = override.embeddingModelId
    methods[SkillSelectionMethod.LLM_DELEGATED].embeddingModelId = override.embeddingModelId
  }

  if ('similarityThreshold' in override && override.similarityThreshold !== undefined) {
    methods[SkillSelectionMethod.EMBEDDING].similarityThreshold = override.similarityThreshold
    methods[SkillSelectionMethod.TWO_STAGE].similarityThreshold = override.similarityThreshold
    methods[SkillSelectionMethod.LLM_ROUTER].similarityThreshold = override.similarityThreshold
    methods[SkillSelectionMethod.LLM_DELEGATED].similarityThreshold = override.similarityThreshold
  }

  if ('topK' in override && override.topK !== undefined) {
    methods[SkillSelectionMethod.EMBEDDING].topK = override.topK
    methods[SkillSelectionMethod.HYBRID].topK = override.topK
    methods[SkillSelectionMethod.TWO_STAGE].topK = override.topK
    methods[SkillSelectionMethod.LLM_ROUTER].topK = override.topK
    methods[SkillSelectionMethod.LLM_DELEGATED].topK = override.topK
  }
}

function mergeSkillMethodConfig<M extends SkillSelectionMethod>(
  methods: SkillMethodConfigMap,
  method: M,
  override: SkillMethodOverrideMap[M]
) {
  methods[method] = {
    ...methods[method],
    ...override
  } as SkillMethodConfigMap[M]
}
