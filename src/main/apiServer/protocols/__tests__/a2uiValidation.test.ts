import { describe, expect, it } from 'vitest'

import { tryExtractA2uiFromAssistantText, validateA2uiPayload } from '../a2uiValidation'

describe('validateA2uiPayload', () => {
  it('accepts object with type string', () => {
    const r = validateA2uiPayload({ type: 'Card', props: {} })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.type).toBe('Card')
  })

  it('rejects arrays', () => {
    const r = validateA2uiPayload([])
    expect(r.ok).toBe(false)
  })
})

describe('tryExtractA2uiFromAssistantText', () => {
  it('parses fenced json', () => {
    const text = 'Here:\n```json\n{"type":"Text","props":{"value":"hi"}}\n```'
    const r = tryExtractA2uiFromAssistantText(text)
    expect(r?.ok).toBe(true)
    if (r?.ok) expect(r.value.type).toBe('Text')
  })
})
