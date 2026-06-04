/**
 * designOrchestrator.test.ts — change-004-artifact-design-orchestrator
 *
 * Tests are written FIRST (TDD RED phase). All external dependencies
 * (generate, compileReact) are injected mocks — no real services touched.
 *
 * Test coverage:
 *   - Happy path: create from empty state, html (no compileReact needed)
 *   - React build failure → repair phase
 *   - Repair turn includes prior diagnostics in prompt
 *   - Edit turn anchors base hash from existing source
 *   - Invalid model JSON → design_run_error, no artifact_full
 *   - Model returns JSON in ```json fences → strips and succeeds
 *   - generate throws → design_run_error, orchestrator resolves
 *   - Events applied to reducer match returned state (fold consistency)
 *   - buildTurnPrompt pure-unit tests
 *   - extractJson pure-unit tests
 */

import { describe, expect, it, vi } from 'vitest'

import type { ArtifactOrchestratorDeps, RunDesignTurnInput } from '../designOrchestrator'
import { buildTurnPrompt, extractJson, runDesignTurn } from '../designOrchestrator'
import type { ArtifactDesignEvent } from '../designProtocol'
import { versionHash } from '../designProtocol'
import type { EditorState } from '../editorReducer'
import { editorReducer, initEditorState } from '../editorReducer'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeHtmlGenerateFn(source = '<div>Hello</div>', language = 'html', notes?: string) {
  const payload: Record<string, unknown> = { source, language }
  if (notes !== undefined) payload.notes = notes
  return vi.fn().mockResolvedValue(JSON.stringify(payload))
}

function makeTsxGenerateFn(source = 'export default function App() { return <div>Hello</div> }') {
  return vi.fn().mockResolvedValue(JSON.stringify({ source, language: 'tsx' }))
}

function makeOkCompileReact() {
  return vi.fn().mockResolvedValue({ ok: true, script: 'bundled', diagnostics: [] })
}

function makeFailCompileReact(diagnostics = ['TS2322: Type mismatch']) {
  return vi.fn().mockResolvedValue({ ok: false, script: '', diagnostics })
}

function makeInput(overrides?: Partial<RunDesignTurnInput>): RunDesignTurnInput {
  return {
    state: initEditorState(),
    request: 'Create a simple hello world page',
    language: 'html',
    turnId: 'turn-001',
    ...overrides
  }
}

function makeDeps(overrides?: Partial<ArtifactOrchestratorDeps>): ArtifactOrchestratorDeps {
  return {
    generate: makeHtmlGenerateFn(),
    compileReact: makeOkCompileReact(),
    ...overrides
  }
}

// Fold all events through editorReducer from a given start state
function foldEvents(startState: EditorState, events: ArtifactDesignEvent[]): EditorState {
  return events.reduce(editorReducer, startState)
}

// ---------------------------------------------------------------------------
// extractJson — pure unit tests
// ---------------------------------------------------------------------------

describe('extractJson', () => {
  it('returns plain JSON unchanged', () => {
    const input = '{"source":"<div/>","language":"html"}'
    expect(extractJson(input)).toBe(input)
  })

  it('strips ```json fences (with newlines)', () => {
    const inner = '{"source":"<div/>","language":"html"}'
    const fenced = `\`\`\`json\n${inner}\n\`\`\``
    expect(extractJson(fenced)).toBe(inner)
  })

  it('strips ``` fences without language tag', () => {
    const inner = '{"source":"<div/>","language":"html"}'
    const fenced = `\`\`\`\n${inner}\n\`\`\``
    expect(extractJson(fenced)).toBe(inner)
  })

  it('strips surrounding prose before/after fences', () => {
    const inner = '{"source":"<div/>","language":"html"}'
    const wrapped = `Here is the JSON:\n\`\`\`json\n${inner}\n\`\`\`\nHope that helps!`
    expect(extractJson(wrapped)).toBe(inner)
  })

  it('returns empty string for empty input', () => {
    expect(extractJson('')).toBe('')
  })

  it('handles whitespace-only input', () => {
    const result = extractJson('   \n  ')
    // no fences → trimmed input returned
    expect(result.trim()).toBe('')
  })

  it('handles nested braces inside fenced JSON', () => {
    const inner = '{"source":"<div style=\\"color:red\\">hi</div>","language":"html","nested":{"a":1}}'
    const fenced = `\`\`\`json\n${inner}\n\`\`\``
    expect(extractJson(fenced)).toBe(inner)
  })
})

// ---------------------------------------------------------------------------
// buildTurnPrompt — pure unit tests
// ---------------------------------------------------------------------------

describe('buildTurnPrompt', () => {
  it('includes the user request', () => {
    const state = initEditorState()
    const result = buildTurnPrompt({ state, request: 'Make it red', language: 'html', turnId: 't1' })
    expect(result.prompt).toContain('Make it red')
  })

  it('includes the language in the prompt', () => {
    const state = initEditorState()
    const result = buildTurnPrompt({ state, request: 'Something', language: 'tsx', turnId: 't1' })
    expect(result.prompt).toContain('tsx')
  })

  it('includes current source in content when state has source', () => {
    const state = initEditorState({ source: '<div>old</div>' })
    const result = buildTurnPrompt({ state, request: 'Edit it', language: 'html', turnId: 't1' })
    expect(result.content).toContain('<div>old</div>')
  })

  it('instructs model to return JSON with source, language, notes fields', () => {
    const state = initEditorState()
    const result = buildTurnPrompt({ state, request: 'Create', language: 'html', turnId: 't1' })
    // The prompt must instruct the model to return a JSON object
    expect(result.prompt).toMatch(/json/i)
    expect(result.prompt).toContain('source')
    expect(result.prompt).toContain('language')
  })

  it('includes prior build diagnostics when lastBuild.ok is false', () => {
    const state = initEditorState({
      lastBuild: { ok: false, diagnostics: ['TS2322: Type mismatch'], errors: [{ text: 'TS2322: Type mismatch' }] }
    })
    const result = buildTurnPrompt({ state, request: 'Fix it', language: 'tsx', turnId: 't1' })
    expect(result.prompt).toContain('TS2322')
  })

  it('does NOT include diagnostics when lastBuild.ok is true', () => {
    const state = initEditorState({
      lastBuild: { ok: true, diagnostics: [], errors: [] }
    })
    const result = buildTurnPrompt({ state, request: 'Tweak', language: 'html', turnId: 't1' })
    // no failed diagnostics to include
    expect(result.prompt).not.toContain('TS2322')
  })

  it('does NOT include diagnostics when lastBuild is null', () => {
    const state = initEditorState()
    const result = buildTurnPrompt({ state, request: 'Create', language: 'html', turnId: 't1' })
    // lastBuild is null — no diagnostic section
    expect(result.prompt).not.toMatch(/previous build (failed|errors)/i)
  })
})

// ---------------------------------------------------------------------------
// runDesignTurn — happy path (create, html, no prior source)
// ---------------------------------------------------------------------------

describe('runDesignTurn — happy path (html create, empty state)', () => {
  it('emits events in order: design_run_start → artifact_full → build_status → design_run_complete', async () => {
    const result = await runDesignTurn(
      makeInput({ language: 'html' }),
      makeDeps({ generate: makeHtmlGenerateFn('<div>Hello</div>') })
    )

    const kinds = result.events.map((e) => e.kind)
    expect(kinds).toEqual(['design_run_start', 'artifact_full', 'build_status', 'design_run_complete'])
  })

  it('design_run_start has baseVersionHash null when no prior source', async () => {
    const result = await runDesignTurn(makeInput(), makeDeps())
    const startEvent = result.events[0]
    expect(startEvent.kind).toBe('design_run_start')
    if (startEvent.kind === 'design_run_start') {
      expect(startEvent.baseVersionHash).toBeNull()
    }
  })

  it('final state.phase is preview after successful build', async () => {
    const result = await runDesignTurn(makeInput({ language: 'html' }), makeDeps())
    expect(result.state.phase).toBe('preview')
  })

  it('final state.source matches the generated source', async () => {
    const source = '<div>Hello World</div>'
    const result = await runDesignTurn(
      makeInput({ language: 'html' }),
      makeDeps({ generate: makeHtmlGenerateFn(source) })
    )
    expect(result.state.source).toBe(source)
  })

  it('final state.headVersionHash equals versionHash of generated source', async () => {
    const source = '<div>Hello World</div>'
    const result = await runDesignTurn(
      makeInput({ language: 'html' }),
      makeDeps({ generate: makeHtmlGenerateFn(source) })
    )
    expect(result.state.headVersionHash).toBe(versionHash(source))
  })

  it('turnId is correctly threaded through all events', async () => {
    const turnId = 'test-turn-42'
    const result = await runDesignTurn(makeInput({ turnId }), makeDeps())
    for (const event of result.events) {
      expect(event.turnId).toBe(turnId)
    }
  })

  it('build_status event is ok=true for valid html', async () => {
    const result = await runDesignTurn(makeInput({ language: 'html' }), makeDeps())
    const buildEvent = result.events.find((e) => e.kind === 'build_status')
    expect(buildEvent).toBeDefined()
    if (buildEvent?.kind === 'build_status') {
      expect(buildEvent.ok).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// runDesignTurn — React build failure → repair phase
// ---------------------------------------------------------------------------

describe('runDesignTurn — React build failure → repair', () => {
  it('emits build_status ok=false when compileReact returns failure', async () => {
    const tsxSource = 'export default function App() { return <div>Hello</div> }'
    const result = await runDesignTurn(
      makeInput({ language: 'tsx' }),
      makeDeps({
        generate: makeTsxGenerateFn(tsxSource),
        compileReact: makeFailCompileReact(['TS2322: Type mismatch'])
      })
    )

    const buildEvent = result.events.find((e) => e.kind === 'build_status')
    expect(buildEvent).toBeDefined()
    if (buildEvent?.kind === 'build_status') {
      expect(buildEvent.ok).toBe(false)
      expect(buildEvent.diagnostics).toContain('TS2322: Type mismatch')
    }
  })

  it('final state.phase is repair when build fails', async () => {
    const result = await runDesignTurn(
      makeInput({ language: 'tsx' }),
      makeDeps({
        generate: makeTsxGenerateFn(),
        compileReact: makeFailCompileReact()
      })
    )
    expect(result.state.phase).toBe('repair')
  })

  it('events include design_run_start, artifact_full, build_status(fail), design_run_complete in order', async () => {
    const result = await runDesignTurn(
      makeInput({ language: 'tsx' }),
      makeDeps({
        generate: makeTsxGenerateFn(),
        compileReact: makeFailCompileReact()
      })
    )

    const kinds = result.events.map((e) => e.kind)
    expect(kinds).toEqual(['design_run_start', 'artifact_full', 'build_status', 'design_run_complete'])
  })

  it('state.lastBuild reflects the failed build', async () => {
    const diagnostics = ['TS2322: Type mismatch', 'TS2304: Cannot find name']
    const result = await runDesignTurn(
      makeInput({ language: 'tsx' }),
      makeDeps({
        generate: makeTsxGenerateFn(),
        compileReact: makeFailCompileReact(diagnostics)
      })
    )
    expect(result.state.lastBuild).not.toBeNull()
    expect(result.state.lastBuild?.ok).toBe(false)
    expect(result.state.lastBuild?.diagnostics).toEqual(diagnostics)
  })
})

// ---------------------------------------------------------------------------
// runDesignTurn — repair turn uses prior diagnostics in prompt
// ---------------------------------------------------------------------------

describe('runDesignTurn — repair turn includes diagnostics in prompt', () => {
  it('buildTurnPrompt includes diagnostics from lastBuild when ok=false', () => {
    const state = initEditorState({
      source: 'export default function App() { return <div>Hello</div> }',
      lastBuild: {
        ok: false,
        diagnostics: ['TS2322: Type mismatch', 'TS2304: Cannot find name x'],
        errors: [{ text: 'TS2322: Type mismatch' }, { text: 'TS2304: Cannot find name x' }]
      }
    })
    const result = buildTurnPrompt({ state, request: 'Fix the type errors', language: 'tsx', turnId: 't-repair' })
    expect(result.prompt).toContain('TS2322')
    expect(result.prompt).toContain('TS2304')
  })

  it('generate is called with prompt containing diagnostics on a repair turn', async () => {
    // First, build a state already in repair with known diagnostics
    const stateInRepair = initEditorState({
      source: 'export default function App() { return <div>Hello</div> }',
      lastBuild: {
        ok: false,
        diagnostics: ['TS2322: specific-error-marker'],
        errors: [{ text: 'TS2322: specific-error-marker' }]
      }
    })

    const generate = vi.fn().mockResolvedValue(JSON.stringify({ source: '<div/>', language: 'tsx' }))

    await runDesignTurn(
      makeInput({ state: stateInRepair, language: 'tsx' }),
      makeDeps({ generate, compileReact: makeOkCompileReact() })
    )

    // The generate call should have received a prompt containing the diagnostic
    expect(generate).toHaveBeenCalledOnce()
    const callArgs = generate.mock.calls[0][0] as { prompt: string; content: string }
    expect(callArgs.prompt).toContain('TS2322: specific-error-marker')
  })
})

// ---------------------------------------------------------------------------
// runDesignTurn — edit turn anchors base hash
// ---------------------------------------------------------------------------

describe('runDesignTurn — edit turn anchors base hash', () => {
  it('design_run_start.baseVersionHash equals versionHash of prior source', async () => {
    const priorSource = '<div>Version A</div>'
    const state = initEditorState({ source: priorSource })

    const result = await runDesignTurn(
      makeInput({ state, language: 'html' }),
      makeDeps({ generate: makeHtmlGenerateFn('<div>Version B</div>') })
    )

    const startEvent = result.events[0]
    expect(startEvent.kind).toBe('design_run_start')
    if (startEvent.kind === 'design_run_start') {
      expect(startEvent.baseVersionHash).toBe(versionHash(priorSource))
    }
  })

  it('baseVersionHash is not null when prior source exists', async () => {
    const state = initEditorState({ source: '<h1>Existing</h1>' })
    const result = await runDesignTurn(makeInput({ state }), makeDeps())
    const startEvent = result.events[0]
    if (startEvent.kind === 'design_run_start') {
      expect(startEvent.baseVersionHash).not.toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// runDesignTurn — invalid model JSON
// ---------------------------------------------------------------------------

describe('runDesignTurn — invalid model JSON', () => {
  it('emits design_run_error when generate returns non-JSON', async () => {
    const generate = vi.fn().mockResolvedValue('This is not JSON at all.')
    const result = await runDesignTurn(makeInput(), makeDeps({ generate }))

    const errorEvent = result.events.find((e) => e.kind === 'design_run_error')
    expect(errorEvent).toBeDefined()
  })

  it('does NOT emit artifact_full on parse failure', async () => {
    const generate = vi.fn().mockResolvedValue('not json')
    const result = await runDesignTurn(makeInput(), makeDeps({ generate }))

    const artifactFull = result.events.find((e) => e.kind === 'artifact_full')
    expect(artifactFull).toBeUndefined()
  })

  it('generate is called exactly once on parse failure', async () => {
    const generate = vi.fn().mockResolvedValue('bad json')
    await runDesignTurn(makeInput(), makeDeps({ generate }))
    expect(generate).toHaveBeenCalledOnce()
  })

  it('emits design_run_error when JSON is valid but schema is invalid (missing language)', async () => {
    const generate = vi.fn().mockResolvedValue(JSON.stringify({ source: '<div/>' })) // missing language
    const result = await runDesignTurn(makeInput(), makeDeps({ generate }))

    const errorEvent = result.events.find((e) => e.kind === 'design_run_error')
    expect(errorEvent).toBeDefined()
  })

  it('emits design_run_error when JSON source is empty string', async () => {
    const generate = vi.fn().mockResolvedValue(JSON.stringify({ source: '', language: 'html' }))
    const result = await runDesignTurn(makeInput(), makeDeps({ generate }))

    const errorEvent = result.events.find((e) => e.kind === 'design_run_error')
    expect(errorEvent).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// runDesignTurn — JSON in fenced code blocks
// ---------------------------------------------------------------------------

describe('runDesignTurn — JSON in ```json fences', () => {
  it('strips ```json fence and parses successfully', async () => {
    const inner = JSON.stringify({ source: '<div>From fence</div>', language: 'html' })
    const fenced = `\`\`\`json\n${inner}\n\`\`\``
    const generate = vi.fn().mockResolvedValue(fenced)

    const result = await runDesignTurn(makeInput({ language: 'html' }), makeDeps({ generate }))

    // Should NOT have an error event
    const errorEvent = result.events.find((e) => e.kind === 'design_run_error')
    expect(errorEvent).toBeUndefined()

    // Should have artifact_full
    const fullEvent = result.events.find((e) => e.kind === 'artifact_full')
    expect(fullEvent).toBeDefined()
    if (fullEvent?.kind === 'artifact_full') {
      expect(fullEvent.source).toBe('<div>From fence</div>')
    }
  })

  it('strips plain ``` fence (no language tag) and parses', async () => {
    const inner = JSON.stringify({ source: '<div>plain fence</div>', language: 'html' })
    const fenced = `\`\`\`\n${inner}\n\`\`\``
    const generate = vi.fn().mockResolvedValue(fenced)

    const result = await runDesignTurn(makeInput({ language: 'html' }), makeDeps({ generate }))
    const fullEvent = result.events.find((e) => e.kind === 'artifact_full')
    expect(fullEvent).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// runDesignTurn — generate throws
// ---------------------------------------------------------------------------

describe('runDesignTurn — generate throws', () => {
  it('emits design_run_error and resolves (does not throw)', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('Network timeout'))

    await expect(runDesignTurn(makeInput(), makeDeps({ generate }))).resolves.toBeDefined()
  })

  it('design_run_error message contains the thrown error message', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('Model unavailable'))
    const result = await runDesignTurn(makeInput(), makeDeps({ generate }))

    const errorEvent = result.events.find((e) => e.kind === 'design_run_error')
    expect(errorEvent).toBeDefined()
    if (errorEvent?.kind === 'design_run_error') {
      expect(errorEvent.message).toContain('Model unavailable')
    }
  })

  it('does NOT emit artifact_full when generate throws', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('fail'))
    const result = await runDesignTurn(makeInput(), makeDeps({ generate }))

    const fullEvent = result.events.find((e) => e.kind === 'artifact_full')
    expect(fullEvent).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// runDesignTurn — events applied to reducer match returned state (fold consistency)
// ---------------------------------------------------------------------------

describe('runDesignTurn — fold consistency: reducer(events) === returned state', () => {
  it('happy html path: folding events from initial state matches returned state', async () => {
    const initialState = initEditorState()
    const result = await runDesignTurn(
      makeInput({ state: initialState, language: 'html' }),
      makeDeps({ generate: makeHtmlGenerateFn('<p>Test</p>') })
    )

    const folded = foldEvents(initialState, result.events)

    expect(folded.phase).toBe(result.state.phase)
    expect(folded.source).toBe(result.state.source)
    expect(folded.headVersionHash).toBe(result.state.headVersionHash)
    expect(folded.lastBuild?.ok).toBe(result.state.lastBuild?.ok)
  })

  it('tsx build failure: folding events matches returned state', async () => {
    const initialState = initEditorState()
    const result = await runDesignTurn(
      makeInput({ state: initialState, language: 'tsx' }),
      makeDeps({
        generate: makeTsxGenerateFn(),
        compileReact: makeFailCompileReact(['TS2322'])
      })
    )

    const folded = foldEvents(initialState, result.events)

    expect(folded.phase).toBe(result.state.phase)
    expect(folded.source).toBe(result.state.source)
    expect(folded.lastBuild?.ok).toBe(result.state.lastBuild?.ok)
  })

  it('error path: folding events from initial state matches returned state', async () => {
    const initialState = initEditorState()
    const generate = vi.fn().mockResolvedValue('not json')
    const result = await runDesignTurn(makeInput({ state: initialState }), makeDeps({ generate }))

    const folded = foldEvents(initialState, result.events)

    expect(folded.phase).toBe(result.state.phase)
    expect(folded.error).toBe(result.state.error)
  })
})
