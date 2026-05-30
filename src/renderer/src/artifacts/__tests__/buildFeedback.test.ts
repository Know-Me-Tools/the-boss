import { describe, expect, it, vi } from 'vitest'

import type { BuildFeedbackDeps, BuildFeedbackInput, CompileReactFn } from '../buildFeedback'
import { runBuildFeedback } from '../buildFeedback'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReactInput(overrides?: Partial<BuildFeedbackInput>): BuildFeedbackInput {
  return {
    turnId: 'turn-1',
    source: 'export default function App() { return <div>Hello</div> }',
    language: 'tsx',
    ...overrides
  }
}

function makeHtmlInput(overrides?: Partial<BuildFeedbackInput>): BuildFeedbackInput {
  return {
    turnId: 'turn-1',
    source: '<div>Hello world</div>',
    language: 'html',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// React (tsx) path
// ---------------------------------------------------------------------------

describe('runBuildFeedback — React (tsx)', () => {
  it('React ok: compileReact returns ok=true, empty diagnostics → build_status ok=true, errors=[], diagnostics=[]', async () => {
    const compileReact: CompileReactFn = vi.fn().mockResolvedValue({
      ok: true,
      script: 'bundled-script',
      diagnostics: []
    })
    const deps: BuildFeedbackDeps = { compileReact }

    const result = await runBuildFeedback(makeReactInput(), deps)

    expect(result.kind).toBe('build_status')
    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('React diagnostics-but-ok: warnings do not become errors when ok=true', async () => {
    const compileReact: CompileReactFn = vi.fn().mockResolvedValue({
      ok: true,
      script: 'bundled-script',
      diagnostics: ['warn: unused variable x']
    })
    const deps: BuildFeedbackDeps = { compileReact }

    const result = await runBuildFeedback(makeReactInput(), deps)

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual(['warn: unused variable x'])
    expect(result.errors).toEqual([])
  })

  it('React hard failure: ok=false → diagnostics preserved, errors derived from diagnostics', async () => {
    const compileReact: CompileReactFn = vi.fn().mockResolvedValue({
      ok: false,
      script: '',
      diagnostics: ['TS2322: Type error', 'TS1005: ; expected']
    })
    const deps: BuildFeedbackDeps = { compileReact }

    const result = await runBuildFeedback(makeReactInput(), deps)

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual(['TS2322: Type error', 'TS1005: ; expected'])
    expect(result.errors).toEqual([{ text: 'TS2322: Type error' }, { text: 'TS1005: ; expected' }])
  })

  it('React IPC throw: compileReact rejects → function RESOLVES with ok=false, not throws', async () => {
    const ipcError = new Error('IPC channel disconnected')
    const compileReact: CompileReactFn = vi.fn().mockRejectedValue(ipcError)
    const deps: BuildFeedbackDeps = { compileReact }

    const result = await runBuildFeedback(makeReactInput(), deps)

    expect(result.kind).toBe('build_status')
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContain('IPC channel disconnected')
    expect(result.errors).toEqual([{ text: 'IPC channel disconnected' }])
  })

  it('React IPC throw with non-Error rejection: still resolves with ok=false', async () => {
    const compileReact: CompileReactFn = vi.fn().mockRejectedValue('string error')
    const deps: BuildFeedbackDeps = { compileReact }

    const result = await runBuildFeedback(makeReactInput(), deps)

    expect(result.ok).toBe(false)
    expect(result.diagnostics.length).toBe(1)
    expect(result.errors.length).toBe(1)
    expect(typeof result.diagnostics[0]).toBe('string')
  })

  it('React: turnId is echoed into the event', async () => {
    const compileReact: CompileReactFn = vi.fn().mockResolvedValue({
      ok: true,
      script: '',
      diagnostics: []
    })
    const deps: BuildFeedbackDeps = { compileReact }

    const result = await runBuildFeedback(makeReactInput({ turnId: 'my-specific-turn-id' }), deps)

    expect(result.turnId).toBe('my-specific-turn-id')
  })

  it('React (jsx): also routes through compileReact, not HTML validator', async () => {
    const compileReact: CompileReactFn = vi.fn().mockResolvedValue({
      ok: true,
      script: 'bundled',
      diagnostics: []
    })
    const deps: BuildFeedbackDeps = { compileReact }

    const result = await runBuildFeedback(makeReactInput({ language: 'jsx' }), deps)

    expect(compileReact).toHaveBeenCalledOnce()
    expect(result.ok).toBe(true)
  })

  it('React: returned object has kind=build_status', async () => {
    const compileReact: CompileReactFn = vi.fn().mockResolvedValue({
      ok: true,
      script: '',
      diagnostics: []
    })
    const deps: BuildFeedbackDeps = { compileReact }

    const result = await runBuildFeedback(makeReactInput(), deps)

    expect(result.kind).toBe('build_status')
  })

  it('React: errors and diagnostics are arrays (matching readonly event shape)', async () => {
    const compileReact: CompileReactFn = vi.fn().mockResolvedValue({
      ok: false,
      script: '',
      diagnostics: ['TS1234: error']
    })
    const deps: BuildFeedbackDeps = { compileReact }

    const result = await runBuildFeedback(makeReactInput(), deps)

    expect(Array.isArray(result.errors)).toBe(true)
    expect(Array.isArray(result.diagnostics)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// HTML path
// ---------------------------------------------------------------------------

describe('runBuildFeedback — HTML', () => {
  // A spy that throws if invoked — ensures compileReact is never called for HTML
  const neverCalledCompileReact: CompileReactFn = vi.fn().mockImplementation(() => {
    throw new Error('compileReact must NOT be called for html language')
  })
  const htmlDeps: BuildFeedbackDeps = { compileReact: neverCalledCompileReact }

  it('HTML valid: well-formed snippet → ok=true, errors=[]', async () => {
    const result = await runBuildFeedback(makeHtmlInput({ source: '<div><p>Hello</p></div>' }), htmlDeps)

    expect(result.kind).toBe('build_status')
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('HTML: compileReact is NOT called for html language', async () => {
    vi.clearAllMocks()
    const spy: CompileReactFn = vi.fn().mockResolvedValue({ ok: true, script: '', diagnostics: [] })
    const deps: BuildFeedbackDeps = { compileReact: spy }

    await runBuildFeedback(makeHtmlInput(), deps)

    expect(spy).not.toHaveBeenCalled()
  })

  it('HTML malformed: stray unclosed tag → ok=false with a diagnostic', async () => {
    const result = await runBuildFeedback(makeHtmlInput({ source: '<div><p>Unclosed' }), htmlDeps)

    expect(result.ok).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('HTML with a bare < in text content is VALID (no false positive)', async () => {
    // A bare `<` is legal in HTML5 text; it must NOT be flagged as malformed,
    // otherwise the iterate loop would be blocked on valid artifacts.
    const result = await runBuildFeedback(makeHtmlInput({ source: '<div>Hello < world</div>' }), htmlDeps)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('HTML containing <script> with JS comparison operators is VALID (regression)', async () => {
    // Real LLM-generated artifacts routinely contain `<`, `>`, and `=>` inside
    // <script>. The validator must not false-positive on these.
    const source = [
      '<div id="app"></div>',
      '<script>',
      '  const isSmall = (size) => size < 10',
      '  const gt = (a, b) => a > b',
      '  if (1 < 2 && 3 > 2) { window.ok = true }',
      '</script>'
    ].join('\n')
    const result = await runBuildFeedback(makeHtmlInput({ source }), htmlDeps)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('HTML with an unclosed <script> block → ok=false', async () => {
    const result = await runBuildFeedback(makeHtmlInput({ source: '<div></div><script>const a = 1' }), htmlDeps)

    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('HTML malformed: deterministic — same broken input produces same result twice', async () => {
    const badSource = '<div><p>Unclosed'
    const r1 = await runBuildFeedback(makeHtmlInput({ source: badSource }), htmlDeps)
    const r2 = await runBuildFeedback(makeHtmlInput({ source: badSource }), htmlDeps)

    expect(r1.ok).toBe(r2.ok)
    expect(r1.diagnostics).toEqual(r2.diagnostics)
    expect(r1.errors).toEqual(r2.errors)
  })

  it('HTML empty source → ok=false (nothing to render)', async () => {
    // Note: empty string bypasses ArtifactDesignTurnPayloadSchema at the seam
    // level; buildFeedback itself must reject it.
    const result = await runBuildFeedback(makeHtmlInput({ source: '' }), htmlDeps)

    expect(result.ok).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it('HTML whitespace-only source → ok=false', async () => {
    const result = await runBuildFeedback(makeHtmlInput({ source: '   \n\t  ' }), htmlDeps)

    expect(result.ok).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it('HTML: turnId is echoed into the event', async () => {
    const spy: CompileReactFn = vi.fn().mockResolvedValue({ ok: true, script: '', diagnostics: [] })
    const result = await runBuildFeedback(makeHtmlInput({ turnId: 'html-turn-42' }), { compileReact: spy })

    expect(result.turnId).toBe('html-turn-42')
  })

  it('HTML unclosed <script> → ok=false', async () => {
    const result = await runBuildFeedback(makeHtmlInput({ source: '<div><script>alert("hello")</div>' }), htmlDeps)

    expect(result.ok).toBe(false)
  })

  it('HTML unclosed <style> → ok=false', async () => {
    const result = await runBuildFeedback(makeHtmlInput({ source: '<style>body { color: red; }</div>' }), htmlDeps)

    expect(result.ok).toBe(false)
  })

  it('HTML valid complex snippet → ok=true', async () => {
    const source = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Test</title></head>
<body><h1>Hello</h1><p>World</p></body>
</html>`
    const result = await runBuildFeedback(makeHtmlInput({ source }), htmlDeps)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })
})
