import { loggerService } from '@logger'

import { A2UI_SCHEMA_VERSION } from './versions'

const logger = loggerService.withContext('A2UIValidation')

export type A2uiValidationResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string }

/**
 * Minimal structural validation for A2UI root documents (catalog-agnostic).
 * Full catalog validation can be layered later via JSON Schema from a2ui.org.
 */
export function validateA2uiPayload(value: unknown): A2uiValidationResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'A2UI root must be a non-null object' }
  }
  const obj = value as Record<string, unknown>
  const t = obj.type
  if (typeof t !== 'string' || t.length === 0) {
    return { ok: false, error: 'A2UI object must include non-empty string "type"' }
  }
  return { ok: true, value: obj }
}

/**
 * Attempts to parse a JSON object from model text (fenced ```json blocks or full body).
 * Returns first valid A2UI root if any.
 */
export function tryExtractA2uiFromAssistantText(text: string): A2uiValidationResult | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const fence = /```(?:json)?\s*([\s\S]*?)```/m.exec(trimmed)
  const candidate = fence ? fence[1].trim() : trimmed

  try {
    const parsed: unknown = JSON.parse(candidate)
    const v = validateA2uiPayload(parsed)
    if (!v.ok) {
      logger.debug('Parsed JSON but not valid A2UI shape', { error: v.error })
      return null
    }
    return v
  } catch {
    return null
  }
}

export function a2uiMetaPayload(): Record<string, string> {
  return {
    schemaVersion: A2UI_SCHEMA_VERSION,
    validated: 'minimal-type-field'
  }
}
