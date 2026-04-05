/**
 * Model Context Window Limits Configuration
 *
 * This module provides context window size information for various LLM models.
 * Values are in tokens and represent the maximum input context length.
 *
 * Sources:
 * - Anthropic: https://docs.anthropic.com/en/docs/about-claude/models
 * - OpenAI: https://platform.openai.com/docs/models
 * - Google: https://cloud.google.com/vertex-ai/docs/generative-ai/model-reference/gemini
 */

import type { Model } from '@renderer/types'

/**
 * Context window limits for common models (in tokens)
 * Keys are lowercase model ID patterns for matching
 */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // ==================== Anthropic Claude Models ====================
  // Claude 4.5 series - 200K default, 1M with beta header
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4.5': 200_000,
  'claude-opus-4-5': 200_000,
  'claude-opus-4.5': 200_000,
  'claude-haiku-4-5': 200_000,
  'claude-haiku-4.5': 200_000,

  // Claude 4 series
  'claude-sonnet-4': 200_000,
  'claude-opus-4': 200_000,
  'claude-haiku-4': 200_000,

  // Claude 3.7 series
  'claude-3-7-sonnet': 200_000,
  'claude-3.7-sonnet': 200_000,

  // Claude 3.5 series
  'claude-3-5-sonnet': 200_000,
  'claude-3.5-sonnet': 200_000,
  'claude-3-5-haiku': 200_000,
  'claude-3.5-haiku': 200_000,

  // Claude 3 series
  'claude-3-opus': 200_000,
  'claude-3-sonnet': 200_000,
  'claude-3-haiku': 200_000,

  // Claude 2.x series
  'claude-2': 100_000,
  'claude-2.0': 100_000,
  'claude-2.1': 200_000,

  // ==================== OpenAI GPT Models ====================
  // GPT-4o series
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4o-audio': 128_000,

  // GPT-4 Turbo
  'gpt-4-turbo': 128_000,
  'gpt-4-turbo-preview': 128_000,
  'gpt-4-1106': 128_000,
  'gpt-4-0125': 128_000,

  // GPT-4 (original)
  'gpt-4': 8_192,
  'gpt-4-32k': 32_768,
  'gpt-4-0613': 8_192,

  // GPT-3.5 Turbo
  'gpt-3.5-turbo': 16_385,
  'gpt-3.5-turbo-16k': 16_385,
  'gpt-3.5-turbo-0125': 16_385,

  // OpenAI o1/o3 reasoning models
  o1: 200_000,
  'o1-preview': 128_000,
  'o1-mini': 128_000,
  o3: 200_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,

  // GPT-5 series (anticipated)
  'gpt-5': 200_000,
  'gpt-5.1': 200_000,
  'gpt-5-codex': 200_000,

  // ==================== Google Gemini Models ====================
  // Gemini 2.x series
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-2.0-flash': 1_000_000,
  'gemini-2.0-pro': 1_000_000,

  // Gemini 1.5 series
  'gemini-1.5-pro': 2_000_000,
  'gemini-1.5-flash': 1_000_000,

  // Gemini 1.0 series
  'gemini-pro': 32_000,
  'gemini-1.0-pro': 32_000,

  // Gemini 3.x series (anticipated)
  'gemini-3': 1_000_000,
  'gemini-3-pro': 1_000_000,
  'gemini-3-flash': 1_000_000,

  // ==================== DeepSeek Models ====================
  'deepseek-chat': 64_000,
  'deepseek-coder': 64_000,
  'deepseek-v2': 128_000,
  'deepseek-v2.5': 128_000,
  'deepseek-v3': 128_000,
  'deepseek-r1': 128_000,

  // ==================== Qwen Models ====================
  'qwen-turbo': 128_000,
  'qwen-plus': 128_000,
  'qwen-max': 128_000,
  'qwen-long': 1_000_000,
  qwen2: 128_000,
  'qwen2.5': 128_000,
  qwen3: 128_000,
  qwq: 128_000,

  // ==================== Meta Llama Models ====================
  'llama-3': 8_192,
  'llama-3.1': 128_000,
  'llama-3.2': 128_000,
  'llama-3.3': 128_000,
  'llama-4': 128_000,

  // ==================== Mistral Models ====================
  'mistral-7b': 32_000,
  'mistral-small': 32_000,
  'mistral-medium': 32_000,
  'mistral-large': 128_000,
  mixtral: 32_000,
  codestral: 32_000,

  // ==================== Cohere Models ====================
  command: 4_096,
  'command-light': 4_096,
  'command-r': 128_000,
  'command-r-plus': 128_000,

  // ==================== xAI Grok Models ====================
  grok: 128_000,
  'grok-2': 128_000,
  'grok-3': 128_000,
  'grok-4': 128_000,

  // ==================== Zhipu GLM Models ====================
  'glm-4': 128_000,
  'glm-4v': 128_000,
  'glm-4.5': 128_000,
  'glm-4.6': 128_000,

  // ==================== Baichuan Models ====================
  baichuan: 32_000,
  baichuan2: 32_000,

  // ==================== Yi Models ====================
  'yi-large': 32_000,
  'yi-medium': 16_000,
  'yi-spark': 16_000,

  // ==================== Doubao Models ====================
  doubao: 128_000,
  'doubao-pro': 128_000,

  // ==================== Hunyuan Models ====================
  hunyuan: 32_000,
  'hunyuan-pro': 128_000,
  'hunyuan-t1': 128_000
}

/**
 * Default context limit when model is not found in the mapping
 * Using a conservative value that works for most models
 */
export const DEFAULT_CONTEXT_LIMIT = 128_000

/**
 * Safety margin to apply when calculating available context
 * We use 90% of the limit to leave room for response tokens and overhead
 */
export const CONTEXT_SAFETY_MARGIN = 0.85

/**
 * Minimum context budget to reserve for response generation
 * Even with context management, we need to leave room for output
 */
export const MIN_RESPONSE_TOKEN_BUDGET = 4_096

/**
 * Get the context window limit for a model
 *
 * @param model - The model object or model ID string
 * @returns The context window limit in tokens
 */
export function getModelContextLimit(model: Model | string): number {
  const modelId = typeof model === 'string' ? model : model.id
  const modelName = typeof model === 'string' ? model : model.name

  // Check if model has a user-defined override
  if (typeof model !== 'string' && model.maxContextTokens) {
    return model.maxContextTokens
  }

  // Normalize model ID for matching
  const normalizedId = modelId.toLowerCase()
  const normalizedName = modelName?.toLowerCase() || ''

  // Try exact match first
  if (MODEL_CONTEXT_LIMITS[normalizedId]) {
    return MODEL_CONTEXT_LIMITS[normalizedId]
  }

  // Try pattern matching (check if any key is contained in the model ID)
  for (const [pattern, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (normalizedId.includes(pattern) || normalizedName.includes(pattern)) {
      return limit
    }
  }

  // Return default limit
  return DEFAULT_CONTEXT_LIMIT
}

/**
 * Get the effective context budget (with safety margin applied)
 *
 * @param model - The model object or model ID string
 * @returns The safe context budget in tokens
 */
export function getEffectiveContextBudget(model: Model | string): number {
  const limit = getModelContextLimit(model)
  return Math.floor(limit * CONTEXT_SAFETY_MARGIN)
}

/**
 * Get the available context budget after reserving space for response
 *
 * @param model - The model object or model ID string
 * @param maxOutputTokens - Expected maximum output tokens (optional)
 * @returns The available context budget for input in tokens
 */
export function getAvailableInputBudget(model: Model | string, maxOutputTokens?: number): number {
  const effectiveBudget = getEffectiveContextBudget(model)
  const responseReserve = maxOutputTokens || MIN_RESPONSE_TOKEN_BUDGET
  return Math.max(0, effectiveBudget - responseReserve)
}

/**
 * Check if a model supports extended context (> 100K tokens)
 *
 * @param model - The model object or model ID string
 * @returns True if the model supports extended context
 */
export function supportsExtendedContext(model: Model | string): boolean {
  return getModelContextLimit(model) > 100_000
}

/**
 * Check if a model supports million-token context
 *
 * @param model - The model object or model ID string
 * @returns True if the model supports 1M+ token context
 */
export function supportsMillionTokenContext(model: Model | string): boolean {
  return getModelContextLimit(model) >= 1_000_000
}
