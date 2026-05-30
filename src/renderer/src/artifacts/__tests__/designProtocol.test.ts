import { describe, expect, it } from 'vitest'

import type { ArtifactDesignEvent, ArtifactDesignTurnPayload } from '../designProtocol'
import { ArtifactDesignTurnPayloadSchema, versionHash } from '../designProtocol'

// ---------------------------------------------------------------------------
// Payload schema tests
// ---------------------------------------------------------------------------

describe('ArtifactDesignTurnPayloadSchema', () => {
  it('accepts a valid payload with all fields', () => {
    const result = ArtifactDesignTurnPayloadSchema.safeParse({
      source: '<div>Hello</div>',
      language: 'html',
      notes: 'Initial render'
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.source).toBe('<div>Hello</div>')
      expect(result.data.language).toBe('html')
      expect(result.data.notes).toBe('Initial render')
    }
  })

  it('accepts a valid payload without optional notes', () => {
    const result = ArtifactDesignTurnPayloadSchema.safeParse({
      source: 'export default function App() { return <div /> }',
      language: 'tsx'
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.notes).toBeUndefined()
    }
  })

  it('accepts jsx as a valid language', () => {
    const result = ArtifactDesignTurnPayloadSchema.safeParse({
      source: 'function App() { return <div /> }',
      language: 'jsx'
    })

    expect(result.success).toBe(true)
  })

  it('rejects when source is missing', () => {
    const result = ArtifactDesignTurnPayloadSchema.safeParse({
      language: 'html'
    })

    expect(result.success).toBe(false)
  })

  it('rejects when source is an empty string', () => {
    const result = ArtifactDesignTurnPayloadSchema.safeParse({
      source: '',
      language: 'html'
    })

    expect(result.success).toBe(false)
  })

  it('rejects when language is missing', () => {
    const result = ArtifactDesignTurnPayloadSchema.safeParse({
      source: '<div />'
    })

    expect(result.success).toBe(false)
  })

  it('rejects an invalid language value', () => {
    const result = ArtifactDesignTurnPayloadSchema.safeParse({
      source: '<div />',
      language: 'python'
    })

    expect(result.success).toBe(false)
  })

  it('rejects when source is null', () => {
    const result = ArtifactDesignTurnPayloadSchema.safeParse({
      source: null,
      language: 'html'
    })

    expect(result.success).toBe(false)
  })

  it('the inferred type is usable for typed assignments', () => {
    // This is a compile-time check. If the type is wrong this file won't typecheck.
    const payload: ArtifactDesignTurnPayload = {
      source: '<div />',
      language: 'html'
    }

    expect(payload.source).toBe('<div />')
  })
})

// ---------------------------------------------------------------------------
// versionHash tests
// ---------------------------------------------------------------------------

describe('versionHash', () => {
  it('returns a non-empty string', () => {
    const hash = versionHash('<div>Hello</div>')

    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
  })

  it('is deterministic: same input produces the same hash twice', () => {
    const input = 'export default function App() { return <main><h1>Hello</h1></main> }'
    const first = versionHash(input)
    const second = versionHash(input)

    expect(first).toBe(second)
  })

  it('produces different hashes for different inputs', () => {
    const hashA = versionHash('<div>Version A</div>')
    const hashB = versionHash('<div>Version B</div>')

    expect(hashA).not.toBe(hashB)
  })

  it('handles empty string without throwing', () => {
    expect(() => versionHash('')).not.toThrow()
    const hash = versionHash('')

    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
  })

  it('distinguishes whitespace-only input from empty string', () => {
    const emptyHash = versionHash('')
    const whitespaceHash = versionHash('   ')

    expect(emptyHash).not.toBe(whitespaceHash)
  })

  it('distinguishes inputs that differ only in whitespace', () => {
    const withNewline = versionHash('<div>\n</div>')
    const withSpace = versionHash('<div> </div>')

    expect(withNewline).not.toBe(withSpace)
  })

  it('handles unicode and emoji characters without throwing', () => {
    expect(() => versionHash('Hello 世界 🎉')).not.toThrow()
    const hash = versionHash('Hello 世界 🎉')

    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
  })

  it('is deterministic for unicode input', () => {
    const input = '你好，世界！🌍'
    expect(versionHash(input)).toBe(versionHash(input))
  })

  it('pins known FNV-1a values to catch accidental algorithm changes', () => {
    // Computed from the current implementation (UTF-16 code units, low/high
    // byte per unit). A change here means the hash algorithm changed — which
    // would silently invalidate every stored version anchor.
    expect(versionHash('')).toBe('811c9dc5')
    expect(versionHash('hello')).toBe('c3457ef7')
  })
})

// ---------------------------------------------------------------------------
// ArtifactDesignEvent discriminated union tests
// ---------------------------------------------------------------------------

describe('ArtifactDesignEvent discriminated union', () => {
  /**
   * A compile-time exhaustiveness check. If the union is missing a variant,
   * the `never` branch becomes reachable and `describeEvent` fails to compile.
   * At runtime this just verifies the function handles all 7 event kinds.
   */
  function describeEvent(event: ArtifactDesignEvent): string {
    switch (event.kind) {
      case 'design_run_start':
        return `run_start turnId=${event.turnId} base=${event.baseVersionHash ?? 'none'}`
      case 'artifact_text_delta':
        return `text_delta turnId=${event.turnId} text=${event.text}`
      case 'artifact_full':
        return `artifact_full turnId=${event.turnId} lang=${event.language}`
      case 'build_status':
        return `build_status turnId=${event.turnId} ok=${event.ok}`
      case 'artifact_saved':
        return `artifact_saved turnId=${event.turnId} recordId=${event.recordId} hash=${event.versionHash}`
      case 'design_run_complete':
        return `run_complete turnId=${event.turnId}`
      case 'design_run_error':
        return `run_error turnId=${event.turnId} msg=${event.message}`
      default: {
        // Exhaustiveness guard — TypeScript should narrow `event` to `never` here.
        const _exhaustive: never = event
        return _exhaustive
      }
    }
  }

  it('narrows design_run_start correctly', () => {
    const event: ArtifactDesignEvent = { kind: 'design_run_start', turnId: 't1', baseVersionHash: null }
    expect(describeEvent(event)).toBe('run_start turnId=t1 base=none')
  })

  it('narrows design_run_start with a base hash', () => {
    const event: ArtifactDesignEvent = { kind: 'design_run_start', turnId: 't2', baseVersionHash: 'abc123' }
    expect(describeEvent(event)).toContain('base=abc123')
  })

  it('narrows artifact_text_delta correctly', () => {
    const event: ArtifactDesignEvent = { kind: 'artifact_text_delta', turnId: 't3', text: 'hello' }
    expect(describeEvent(event)).toBe('text_delta turnId=t3 text=hello')
  })

  it('narrows artifact_full correctly', () => {
    const event: ArtifactDesignEvent = { kind: 'artifact_full', turnId: 't4', source: '<div />', language: 'html' }
    expect(describeEvent(event)).toBe('artifact_full turnId=t4 lang=html')
  })

  it('narrows build_status correctly — ok=true', () => {
    const event: ArtifactDesignEvent = {
      kind: 'build_status',
      turnId: 't5',
      ok: true,
      diagnostics: [],
      errors: []
    }

    expect(describeEvent(event)).toBe('build_status turnId=t5 ok=true')
  })

  it('narrows build_status correctly — ok=false with errors', () => {
    const event: ArtifactDesignEvent = {
      kind: 'build_status',
      turnId: 't5b',
      ok: false,
      diagnostics: ['TS2322: Type error'],
      errors: [{ text: 'Cannot assign to read-only property' }]
    }

    expect(describeEvent(event)).toBe('build_status turnId=t5b ok=false')
    expect(event.diagnostics).toHaveLength(1)
    expect(event.errors[0].text).toBe('Cannot assign to read-only property')
  })

  it('narrows artifact_saved correctly', () => {
    const event: ArtifactDesignEvent = {
      kind: 'artifact_saved',
      turnId: 't6',
      recordId: 'rec-1',
      versionHash: 'deadbeef'
    }

    expect(describeEvent(event)).toBe('artifact_saved turnId=t6 recordId=rec-1 hash=deadbeef')
  })

  it('narrows design_run_complete correctly', () => {
    const event: ArtifactDesignEvent = { kind: 'design_run_complete', turnId: 't7' }
    expect(describeEvent(event)).toBe('run_complete turnId=t7')
  })

  it('narrows design_run_error correctly', () => {
    const event: ArtifactDesignEvent = { kind: 'design_run_error', turnId: 't8', message: 'Model timeout' }
    expect(describeEvent(event)).toBe('run_error turnId=t8 msg=Model timeout')
  })
})
