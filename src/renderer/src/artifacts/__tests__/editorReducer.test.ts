import { describe, expect, it } from 'vitest'

import { versionHash } from '../designProtocol'
import type { ArtifactDesignEvent } from '../designProtocol'
import { editorReducer, initEditorState } from '../editorReducer'
import type { EditorPhase, EditorState } from '../editorReducer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_V1 = '<div>Version 1</div>'
const SOURCE_V2 = '<div>Version 2</div>'
const HASH_V1 = versionHash(SOURCE_V1)
const HASH_V2 = versionHash(SOURCE_V2)

function makeStart(turnId: string, baseVersionHash: string | null): ArtifactDesignEvent {
  return { kind: 'design_run_start', turnId, baseVersionHash }
}

function makeDelta(turnId: string, text: string): ArtifactDesignEvent {
  return { kind: 'artifact_text_delta', turnId, text }
}

function makeFull(turnId: string, source: string, language: 'html' | 'tsx' | 'jsx' = 'html'): ArtifactDesignEvent {
  return { kind: 'artifact_full', turnId, source, language }
}

function makeBuildStatus(
  turnId: string,
  ok: boolean,
  diagnostics: readonly string[] = [],
  errors: readonly { readonly text: string }[] = []
): ArtifactDesignEvent {
  return { kind: 'build_status', turnId, ok, diagnostics, errors }
}

function makeSaved(turnId: string, recordId: string, hash: string): ArtifactDesignEvent {
  return { kind: 'artifact_saved', turnId, recordId, versionHash: hash }
}

function makeComplete(turnId: string): ArtifactDesignEvent {
  return { kind: 'design_run_complete', turnId }
}

function makeError(turnId: string, message: string): ArtifactDesignEvent {
  return { kind: 'design_run_error', turnId, message }
}

// ---------------------------------------------------------------------------
// 1. Initial state shape
// ---------------------------------------------------------------------------

describe('initEditorState', () => {
  it('returns the correct default shape', () => {
    const s = initEditorState()
    expect(s.phase).toBe<EditorPhase>('idle')
    expect(s.source).toBe('')
    expect(s.language).toBe('html')
    expect(s.headVersionHash).toBe('')
    expect(s.activeTurnId).toBeNull()
    expect(s.streamingText).toBe('')
    expect(s.lastBuild).toBeNull()
    expect(s.savedRecordId).toBeNull()
    expect(s.error).toBeNull()
    expect(s.history).toEqual([])
  })

  it('allows partial overrides via init param', () => {
    const s = initEditorState({ source: SOURCE_V1, language: 'tsx' })
    expect(s.source).toBe(SOURCE_V1)
    expect(s.language).toBe('tsx')
    // headVersionHash must be consistent with the overridden source
    expect(s.headVersionHash).toBe(HASH_V1)
  })

  it('headVersionHash is empty string when source is empty', () => {
    const s = initEditorState()
    expect(s.headVersionHash).toBe('')
  })

  it('returns a frozen-compatible object with all required fields', () => {
    const s = initEditorState()
    const keys: (keyof EditorState)[] = [
      'phase',
      'source',
      'language',
      'headVersionHash',
      'activeTurnId',
      'streamingText',
      'lastBuild',
      'savedRecordId',
      'error',
      'history'
    ]
    for (const k of keys) {
      expect(s).toHaveProperty(k)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. design_run_start — first turn (baseVersionHash: null)
// ---------------------------------------------------------------------------

describe('design_run_start — first turn (base=null)', () => {
  it('transitions idle → streaming', () => {
    const s0 = initEditorState()
    const s1 = editorReducer(s0, makeStart('t1', null))
    expect(s1.phase).toBe<EditorPhase>('streaming')
  })

  it('sets activeTurnId', () => {
    const s0 = initEditorState()
    const s1 = editorReducer(s0, makeStart('t1', null))
    expect(s1.activeTurnId).toBe('t1')
  })

  it('clears streamingText', () => {
    const s0 = initEditorState({ streamingText: 'leftover' } as Partial<EditorState>)
    const s1 = editorReducer(s0, makeStart('t1', null))
    expect(s1.streamingText).toBe('')
  })

  it('clears error', () => {
    const s0: EditorState = { ...initEditorState(), error: 'prior error', phase: 'error' }
    const s1 = editorReducer(s0, makeStart('t1', null))
    expect(s1.error).toBeNull()
  })

  it('does not mutate input state (immutability)', () => {
    const s0 = Object.freeze(initEditorState())
    const event = Object.freeze(makeStart('t1', null))
    expect(() => editorReducer(s0, event)).not.toThrow()
    const s1 = editorReducer(s0, event)
    expect(s1).not.toBe(s0)
    expect(s0.phase).toBe('idle')
  })
})

// ---------------------------------------------------------------------------
// 3. Stale-turn rejection (headline correctness test)
// ---------------------------------------------------------------------------

describe('design_run_start — stale-turn rejection', () => {
  it('goes to error when baseVersionHash does not match headVersionHash', () => {
    const s0: EditorState = {
      ...initEditorState(),
      source: SOURCE_V1,
      headVersionHash: HASH_V1
    }
    const staleHash = HASH_V2 // deliberately wrong
    const s1 = editorReducer(s0, makeStart('t2', staleHash))
    expect(s1.phase).toBe<EditorPhase>('error')
    expect(s1.error).toBeTruthy()
  })

  it('does NOT change source on stale-turn rejection', () => {
    const s0: EditorState = {
      ...initEditorState(),
      source: SOURCE_V1,
      headVersionHash: HASH_V1
    }
    const s1 = editorReducer(s0, makeStart('t2', HASH_V2))
    expect(s1.source).toBe(SOURCE_V1)
  })

  it('does NOT change headVersionHash on stale-turn rejection', () => {
    const s0: EditorState = {
      ...initEditorState(),
      source: SOURCE_V1,
      headVersionHash: HASH_V1
    }
    const s1 = editorReducer(s0, makeStart('t2', HASH_V2))
    expect(s1.headVersionHash).toBe(HASH_V1)
  })

  it('error message includes context about the mismatch', () => {
    const s0: EditorState = {
      ...initEditorState(),
      source: SOURCE_V1,
      headVersionHash: HASH_V1
    }
    const s1 = editorReducer(s0, makeStart('t2', HASH_V2))
    expect(s1.error).toContain(HASH_V2)
  })

  it('accepts when baseVersionHash matches headVersionHash exactly', () => {
    const s0: EditorState = {
      ...initEditorState(),
      source: SOURCE_V1,
      headVersionHash: HASH_V1,
      phase: 'idle'
    }
    const s1 = editorReducer(s0, makeStart('t2', HASH_V1))
    expect(s1.phase).toBe<EditorPhase>('streaming')
  })
})

// ---------------------------------------------------------------------------
// 4. artifact_text_delta
// ---------------------------------------------------------------------------

describe('artifact_text_delta', () => {
  function inStreaming(): EditorState {
    return editorReducer(initEditorState(), makeStart('t1', null))
  }

  it('appends text to streamingText when turnId matches', () => {
    const s0 = inStreaming()
    const s1 = editorReducer(s0, makeDelta('t1', 'hello'))
    expect(s1.streamingText).toBe('hello')
  })

  it('accumulates multiple deltas', () => {
    const s0 = inStreaming()
    const s1 = editorReducer(s0, makeDelta('t1', 'foo'))
    const s2 = editorReducer(s1, makeDelta('t1', ' bar'))
    expect(s2.streamingText).toBe('foo bar')
  })

  it('stays in streaming phase', () => {
    const s0 = inStreaming()
    const s1 = editorReducer(s0, makeDelta('t1', 'x'))
    expect(s1.phase).toBe<EditorPhase>('streaming')
  })

  it('is a no-op when turnId does not match activeTurnId', () => {
    const s0 = inStreaming() // activeTurnId = 't1'
    const s1 = editorReducer(s0, makeDelta('stale-turn', 'ignored'))
    expect(s1).toStrictEqual(s0)
  })

  it('does not mutate inputs', () => {
    const s0 = Object.freeze(inStreaming())
    const event = Object.freeze(makeDelta('t1', 'chunk'))
    expect(() => editorReducer(s0, event)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 5. artifact_full
// ---------------------------------------------------------------------------

describe('artifact_full', () => {
  function inStreaming(startHash: string | null = null): EditorState {
    return editorReducer(initEditorState(), makeStart('t1', startHash))
  }

  it('sets source from event', () => {
    const s0 = inStreaming()
    const s1 = editorReducer(s0, makeFull('t1', SOURCE_V1))
    expect(s1.source).toBe(SOURCE_V1)
  })

  it('sets language from event', () => {
    const s0 = inStreaming()
    const s1 = editorReducer(s0, makeFull('t1', SOURCE_V1, 'tsx'))
    expect(s1.language).toBe('tsx')
  })

  it('recomputes headVersionHash to equal versionHash(source)', () => {
    const s0 = inStreaming()
    const s1 = editorReducer(s0, makeFull('t1', SOURCE_V1))
    expect(s1.headVersionHash).toBe(versionHash(SOURCE_V1))
  })

  it('headVersionHash always equals versionHash(source)', () => {
    const s0 = inStreaming()
    const s1 = editorReducer(s0, makeFull('t1', SOURCE_V2))
    expect(s1.headVersionHash).toBe(versionHash(s1.source))
  })

  it('appends to history', () => {
    const s0 = inStreaming()
    const s1 = editorReducer(s0, makeFull('t1', SOURCE_V1))
    expect(s1.history).toHaveLength(1)
    expect(s1.history[0].source).toBe(SOURCE_V1)
    expect(s1.history[0].versionHash).toBe(HASH_V1)
  })

  it('clears streamingText', () => {
    let s = inStreaming()
    s = editorReducer(s, makeDelta('t1', 'partial'))
    s = editorReducer(s, makeFull('t1', SOURCE_V1))
    expect(s.streamingText).toBe('')
  })

  it('transitions to building phase', () => {
    const s0 = inStreaming()
    const s1 = editorReducer(s0, makeFull('t1', SOURCE_V1))
    expect(s1.phase).toBe<EditorPhase>('building')
  })

  it('is a no-op when turnId does not match activeTurnId', () => {
    const s0 = inStreaming()
    const s1 = editorReducer(s0, makeFull('wrong-turn', SOURCE_V1))
    expect(s1).toStrictEqual(s0)
  })

  it('does not mutate inputs', () => {
    const s0 = Object.freeze(inStreaming())
    const event = Object.freeze(makeFull('t1', SOURCE_V1))
    expect(() => editorReducer(s0, event)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 6. build_status
// ---------------------------------------------------------------------------

describe('build_status', () => {
  function inBuilding(): EditorState {
    let s = initEditorState()
    s = editorReducer(s, makeStart('t1', null))
    s = editorReducer(s, makeFull('t1', SOURCE_V1))
    return s
  }

  it('transitions to preview when ok=true', () => {
    const s0 = inBuilding()
    const s1 = editorReducer(s0, makeBuildStatus('t1', true))
    expect(s1.phase).toBe<EditorPhase>('preview')
  })

  it('transitions to repair when ok=false', () => {
    const s0 = inBuilding()
    const s1 = editorReducer(s0, makeBuildStatus('t1', false, ['TS2322'], [{ text: 'error' }]))
    expect(s1.phase).toBe<EditorPhase>('repair')
  })

  it('sets lastBuild with ok, diagnostics, and errors on success', () => {
    const s0 = inBuilding()
    const s1 = editorReducer(s0, makeBuildStatus('t1', true, ['info'], []))
    expect(s1.lastBuild).toEqual({ ok: true, diagnostics: ['info'], errors: [] })
  })

  it('sets lastBuild with ok, diagnostics, and errors on failure', () => {
    const s0 = inBuilding()
    const diag = ['TS2322: Type mismatch']
    const errs = [{ text: 'Cannot assign' }]
    const s1 = editorReducer(s0, makeBuildStatus('t1', false, diag, errs))
    expect(s1.lastBuild).toEqual({ ok: false, diagnostics: diag, errors: errs })
  })

  it('is a no-op when turnId does not match activeTurnId', () => {
    const s0 = inBuilding()
    const s1 = editorReducer(s0, makeBuildStatus('wrong', true))
    expect(s1).toStrictEqual(s0)
  })

  it('does not mutate inputs', () => {
    const s0 = Object.freeze(inBuilding())
    const event = Object.freeze(makeBuildStatus('t1', true))
    expect(() => editorReducer(s0, event)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 7. artifact_saved
// ---------------------------------------------------------------------------

describe('artifact_saved', () => {
  function inPreview(): EditorState {
    let s = initEditorState()
    s = editorReducer(s, makeStart('t1', null))
    s = editorReducer(s, makeFull('t1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('t1', true))
    return s
  }

  it('transitions preview → idle', () => {
    const s0 = inPreview()
    const s1 = editorReducer(s0, makeSaved('t1', 'rec-1', HASH_V1))
    expect(s1.phase).toBe<EditorPhase>('idle')
  })

  it('sets savedRecordId', () => {
    const s0 = inPreview()
    const s1 = editorReducer(s0, makeSaved('t1', 'rec-abc', HASH_V1))
    expect(s1.savedRecordId).toBe('rec-abc')
  })

  it('goes to error when versionHash does not match headVersionHash (stale save)', () => {
    const s0 = inPreview()
    // headVersionHash is HASH_V1; send a mismatched hash
    const s1 = editorReducer(s0, makeSaved('t1', 'rec-1', HASH_V2))
    expect(s1.phase).toBe<EditorPhase>('error')
    expect(s1.error).toBeTruthy()
  })

  it('is a no-op when turnId does not match activeTurnId', () => {
    const s0 = inPreview()
    const s1 = editorReducer(s0, makeSaved('wrong', 'rec-1', HASH_V1))
    expect(s1).toStrictEqual(s0)
  })

  it('does not mutate inputs', () => {
    const s0 = Object.freeze(inPreview())
    const event = Object.freeze(makeSaved('t1', 'rec-1', HASH_V1))
    expect(() => editorReducer(s0, event)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 8. design_run_complete
// ---------------------------------------------------------------------------

describe('design_run_complete', () => {
  function inPreview(): EditorState {
    let s = initEditorState()
    s = editorReducer(s, makeStart('t1', null))
    s = editorReducer(s, makeFull('t1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('t1', true))
    return s
  }

  function inRepair(): EditorState {
    let s = initEditorState()
    s = editorReducer(s, makeStart('t1', null))
    s = editorReducer(s, makeFull('t1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('t1', false))
    return s
  }

  it('clears activeTurnId', () => {
    const s0 = inPreview()
    const s1 = editorReducer(s0, makeComplete('t1'))
    expect(s1.activeTurnId).toBeNull()
  })

  it('keeps preview phase after complete from preview', () => {
    const s0 = inPreview()
    const s1 = editorReducer(s0, makeComplete('t1'))
    expect(s1.phase).toBe<EditorPhase>('preview')
  })

  it('keeps repair phase after complete from repair', () => {
    const s0 = inRepair()
    const s1 = editorReducer(s0, makeComplete('t1'))
    expect(s1.phase).toBe<EditorPhase>('repair')
  })

  it('is a no-op when turnId does not match activeTurnId', () => {
    const s0 = inPreview()
    const s1 = editorReducer(s0, makeComplete('wrong'))
    expect(s1).toStrictEqual(s0)
  })

  it('does not mutate inputs', () => {
    const s0 = Object.freeze(inPreview())
    const event = Object.freeze(makeComplete('t1'))
    expect(() => editorReducer(s0, event)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 9. design_run_error
// ---------------------------------------------------------------------------

describe('design_run_error', () => {
  function inStreaming(): EditorState {
    return editorReducer(initEditorState(), makeStart('t1', null))
  }

  it('transitions any active phase to error', () => {
    const s0 = inStreaming()
    const s1 = editorReducer(s0, makeError('t1', 'Model timeout'))
    expect(s1.phase).toBe<EditorPhase>('error')
  })

  it('sets error message', () => {
    const s0 = inStreaming()
    const s1 = editorReducer(s0, makeError('t1', 'Model timeout'))
    expect(s1.error).toBe('Model timeout')
  })

  it('clears activeTurnId', () => {
    const s0 = inStreaming()
    const s1 = editorReducer(s0, makeError('t1', 'timeout'))
    expect(s1.activeTurnId).toBeNull()
  })

  it('is a no-op when turnId does not match the active turn (stale-turn filtering)', () => {
    const s0 = inStreaming() // activeTurnId='t1'
    // A late/stale error for a different turn must NOT kill the active turn.
    // The reducer returns state unchanged (same reference) when activeTurnId is
    // non-null and the error's turnId does not match.
    const s1 = editorReducer(s0, makeError('other', 'unexpected'))
    expect(s1).toBe(s0)
    expect(s1.phase).toBe<EditorPhase>('streaming')
  })

  it('does not mutate inputs', () => {
    const s0 = Object.freeze(inStreaming())
    const event = Object.freeze(makeError('t1', 'oops'))
    expect(() => editorReducer(s0, event)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 10. Error recovery — design_run_start after error
// ---------------------------------------------------------------------------

describe('error recovery via design_run_start', () => {
  it('recovers from error phase into streaming on null base', () => {
    let s = initEditorState()
    s = editorReducer(s, makeStart('t1', null))
    s = editorReducer(s, makeError('t1', 'boom'))
    expect(s.phase).toBe('error')

    s = editorReducer(s, makeStart('t2', null))
    expect(s.phase).toBe<EditorPhase>('streaming')
    expect(s.error).toBeNull()
    expect(s.activeTurnId).toBe('t2')
  })

  it('recovers with matching base hash after error', () => {
    let s: EditorState = {
      ...initEditorState(),
      source: SOURCE_V1,
      headVersionHash: HASH_V1,
      phase: 'error',
      error: 'previous error',
      activeTurnId: null
    }
    s = editorReducer(s, makeStart('t3', HASH_V1))
    expect(s.phase).toBe<EditorPhase>('streaming')
    expect(s.error).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 11. Active-turn replacement — design_run_start while another turn is active
// ---------------------------------------------------------------------------

describe('design_run_start while another turn is active', () => {
  it('rejects a new start while a turn is in-flight (goes to error)', () => {
    // Design decision: reject with error rather than silently replacing,
    // to prevent race conditions in the orchestration layer.
    const s0 = editorReducer(initEditorState(), makeStart('t1', null))
    expect(s0.activeTurnId).toBe('t1')
    expect(s0.phase).toBe('streaming')

    const s1 = editorReducer(s0, makeStart('t2', null))
    expect(s1.phase).toBe<EditorPhase>('error')
    expect(s1.error).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// 12. Full happy path: start → delta×2 → artifact_full → build ok → saved → complete
// ---------------------------------------------------------------------------

describe('full happy path', () => {
  it('walks through the complete lifecycle asserting state at each step', () => {
    // 1. idle → streaming
    let s = initEditorState()
    s = editorReducer(s, makeStart('t1', null))
    expect(s.phase).toBe('streaming')
    expect(s.activeTurnId).toBe('t1')
    expect(s.streamingText).toBe('')

    // 2. streaming: accumulate two deltas
    s = editorReducer(s, makeDelta('t1', '<div>'))
    s = editorReducer(s, makeDelta('t1', '</div>'))
    expect(s.phase).toBe('streaming')
    expect(s.streamingText).toBe('<div></div>')

    // 3. artifact_full → building
    s = editorReducer(s, makeFull('t1', SOURCE_V1, 'html'))
    expect(s.phase).toBe('building')
    expect(s.source).toBe(SOURCE_V1)
    expect(s.language).toBe('html')
    expect(s.headVersionHash).toBe(HASH_V1)
    expect(s.streamingText).toBe('')
    expect(s.history).toHaveLength(1)
    expect(s.history[0].versionHash).toBe(HASH_V1)

    // 4. build_status(ok) → preview
    s = editorReducer(s, makeBuildStatus('t1', true, [], []))
    expect(s.phase).toBe('preview')
    expect(s.lastBuild?.ok).toBe(true)

    // 5. artifact_saved → idle
    s = editorReducer(s, makeSaved('t1', 'rec-001', HASH_V1))
    expect(s.phase).toBe('idle')
    expect(s.savedRecordId).toBe('rec-001')

    // 6. design_run_complete → idle, no activeTurnId
    s = editorReducer(s, makeComplete('t1'))
    expect(s.phase).toBe('idle')
    expect(s.activeTurnId).toBeNull()

    // headVersionHash always equals versionHash(source)
    expect(s.headVersionHash).toBe(versionHash(s.source))
  })
})

// ---------------------------------------------------------------------------
// 13. Repair loop
// ---------------------------------------------------------------------------

describe('repair loop', () => {
  it('build failure → repair → new turn with current head → recovers', () => {
    // Turn 1: start, full, build fail → repair
    let s = initEditorState()
    s = editorReducer(s, makeStart('t1', null))
    s = editorReducer(s, makeFull('t1', SOURCE_V1, 'html'))
    s = editorReducer(s, makeBuildStatus('t1', false, ['TS2322'], [{ text: 'err' }]))
    expect(s.phase).toBe('repair')
    expect(s.lastBuild?.ok).toBe(false)

    // complete turn 1
    s = editorReducer(s, makeComplete('t1'))
    expect(s.activeTurnId).toBeNull()

    // Turn 2: start with current head hash (matches) → streaming → full → build ok → preview
    s = editorReducer(s, makeStart('t2', HASH_V1))
    expect(s.phase).toBe('streaming')
    expect(s.error).toBeNull()

    s = editorReducer(s, makeFull('t2', SOURCE_V2, 'html'))
    expect(s.source).toBe(SOURCE_V2)
    expect(s.headVersionHash).toBe(HASH_V2)
    expect(s.history).toHaveLength(2)

    s = editorReducer(s, makeBuildStatus('t2', true))
    expect(s.phase).toBe('preview')
    expect(s.lastBuild?.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 14. headVersionHash invariant — always equals versionHash(source)
// ---------------------------------------------------------------------------

describe('headVersionHash invariant', () => {
  it('equals versionHash(source) after artifact_full', () => {
    let s = initEditorState()
    s = editorReducer(s, makeStart('t1', null))
    s = editorReducer(s, makeFull('t1', SOURCE_V1))
    expect(s.headVersionHash).toBe(versionHash(s.source))
  })

  it('equals versionHash(source) across multiple turns', () => {
    let s = initEditorState()
    s = editorReducer(s, makeStart('t1', null))
    s = editorReducer(s, makeFull('t1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('t1', true))
    s = editorReducer(s, makeComplete('t1'))

    s = editorReducer(s, makeStart('t2', HASH_V1))
    s = editorReducer(s, makeFull('t2', SOURCE_V2))
    expect(s.headVersionHash).toBe(versionHash(s.source))
  })

  it('is empty string when source is empty (initial state)', () => {
    const s = initEditorState()
    expect(s.headVersionHash).toBe('')
    expect(s.source).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 15. Stale save (artifact_saved with mismatched versionHash)
// ---------------------------------------------------------------------------

describe('artifact_saved with mismatched versionHash', () => {
  it('goes to error when versionHash does not match current headVersionHash', () => {
    let s = initEditorState()
    s = editorReducer(s, makeStart('t1', null))
    s = editorReducer(s, makeFull('t1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('t1', true))
    expect(s.headVersionHash).toBe(HASH_V1)

    // Saving with the wrong hash (e.g. a stale async save)
    const s1 = editorReducer(s, makeSaved('t1', 'rec-1', HASH_V2))
    expect(s1.phase).toBe('error')
    expect(s1.error).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// 16. Purity — same (state, event) always yields equal result
// ---------------------------------------------------------------------------

describe('purity', () => {
  it('is referentially transparent: same inputs → structurally equal output', () => {
    const s0 = initEditorState()
    const event = makeStart('t1', null)
    const r1 = editorReducer(s0, event)
    const r2 = editorReducer(s0, event)
    expect(r1).toStrictEqual(r2)
  })

  it('does not mutate the input state (Object.freeze check)', () => {
    const s0 = Object.freeze({
      ...initEditorState(),
      phase: 'idle' as EditorPhase
    })
    const event = Object.freeze(makeStart('t1', null))
    const s1 = editorReducer(s0, event)
    // s0 must be unchanged
    expect(s0.phase).toBe('idle')
    expect(s1).not.toBe(s0)
  })

  it('does not mutate nested arrays (history)', () => {
    let s = initEditorState()
    s = editorReducer(s, makeStart('t1', null))
    const frozenHistory = Object.freeze(s.history)
    const frozenState = Object.freeze({ ...s, history: frozenHistory })
    const event = Object.freeze(makeFull('t1', SOURCE_V1))
    expect(() => editorReducer(frozenState, event)).not.toThrow()
    const s1 = editorReducer(frozenState, event)
    expect(s1.history).toHaveLength(1)
    expect(frozenHistory).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 17. No-op for events with non-active turnId
// ---------------------------------------------------------------------------

describe('events for non-active turnId are no-ops', () => {
  it('artifact_text_delta for stale turn → same state reference equality', () => {
    const s0 = editorReducer(initEditorState(), makeStart('t1', null))
    const s1 = editorReducer(s0, makeDelta('stale', 'ignored'))
    expect(s1).toStrictEqual(s0)
  })

  it('artifact_full for stale turn → same state', () => {
    const s0 = editorReducer(initEditorState(), makeStart('t1', null))
    const s1 = editorReducer(s0, makeFull('stale', SOURCE_V1))
    expect(s1).toStrictEqual(s0)
  })

  it('build_status for stale turn → same state', () => {
    let s = initEditorState()
    s = editorReducer(s, makeStart('t1', null))
    s = editorReducer(s, makeFull('t1', SOURCE_V1))
    const s1 = editorReducer(s, makeBuildStatus('stale', true))
    expect(s1).toStrictEqual(s)
  })

  it('artifact_saved for stale turn → same state', () => {
    let s = initEditorState()
    s = editorReducer(s, makeStart('t1', null))
    s = editorReducer(s, makeFull('t1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('t1', true))
    const s1 = editorReducer(s, makeSaved('stale', 'rec', HASH_V1))
    expect(s1).toStrictEqual(s)
  })

  it('design_run_complete for stale turn → same state', () => {
    let s = initEditorState()
    s = editorReducer(s, makeStart('t1', null))
    s = editorReducer(s, makeFull('t1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('t1', true))
    const s1 = editorReducer(s, makeComplete('stale'))
    expect(s1).toStrictEqual(s)
  })
})

// ---------------------------------------------------------------------------
// 18. History is append-only across multiple turns
// ---------------------------------------------------------------------------

describe('history is append-only', () => {
  it('grows by one entry per artifact_full event', () => {
    let s = initEditorState()

    // Turn 1
    s = editorReducer(s, makeStart('t1', null))
    s = editorReducer(s, makeFull('t1', SOURCE_V1))
    expect(s.history).toHaveLength(1)

    s = editorReducer(s, makeBuildStatus('t1', true))
    s = editorReducer(s, makeComplete('t1'))

    // Turn 2
    s = editorReducer(s, makeStart('t2', HASH_V1))
    s = editorReducer(s, makeFull('t2', SOURCE_V2))
    expect(s.history).toHaveLength(2)
    expect(s.history[0].versionHash).toBe(HASH_V1)
    expect(s.history[1].versionHash).toBe(HASH_V2)
  })
})

// ---------------------------------------------------------------------------
// 19. EditorPhase type is exported and contains all expected values
// ---------------------------------------------------------------------------

describe('EditorPhase type', () => {
  it('accepts all expected phase values', () => {
    const phases: EditorPhase[] = [
      'idle',
      'prompting',
      'streaming',
      'applying',
      'building',
      'preview',
      'repair',
      'saving',
      'error'
    ]
    // Just verify each is a string — this is mainly a compile-time type check
    for (const p of phases) {
      expect(typeof p).toBe('string')
    }
  })
})

// ---------------------------------------------------------------------------
// 20. design_run_error — turnId filtering behavior (regression tests)
//
// The reducer DOES filter design_run_error by activeTurnId when a turn is active.
// Design decision: a late/stale error for a non-active turn must not kill the
// currently running turn. The error is silently dropped (same state reference).
// When no turn is active (activeTurnId === null) the error is surfaced defensively.
// ---------------------------------------------------------------------------

describe('design_run_error — filtered by activeTurnId when a turn is active', () => {
  it('late error for a non-active turn is a no-op (state unchanged, same reference)', () => {
    // Arrange: active turn is 'B'
    const s0 = editorReducer(initEditorState(), makeStart('B', null))
    expect(s0.phase).toBe('streaming')
    expect(s0.activeTurnId).toBe('B')

    // Act: dispatch error for a different, old turn 'A'
    const result = editorReducer(s0, makeError('A', 'turn A timed out'))

    // Assert: stale error is ignored — state is unchanged, turn 'B' stays active
    expect(result).toBe(s0)
    expect(result.phase).toBe<EditorPhase>('streaming')
    expect(result.activeTurnId).toBe('B')
    expect(result.error).toBeNull()
  })

  it('late error for a non-active turn returns the same state reference (no-op)', () => {
    // Arrange
    const s0 = editorReducer(initEditorState(), makeStart('B', null))

    // Act
    const result = editorReducer(s0, makeError('A', 'stale error'))

    // Assert: same reference — the stale error did not produce a new state object
    expect(result).toBe(s0)
  })

  it('error whose turnId matches the active turn also surfaces as error', () => {
    // Arrange: active turn is 'T1'
    const s0 = editorReducer(initEditorState(), makeStart('T1', null))

    // Act
    const result = editorReducer(s0, makeError('T1', 'model failed'))

    // Assert
    expect(result.phase).toBe<EditorPhase>('error')
    expect(result.error).toBe('model failed')
    expect(result.activeTurnId).toBeNull()
  })

  it('error when activeTurnId is null (no active turn) still surfaces defensively', () => {
    // Arrange: fresh idle state — no active turn
    const s0 = initEditorState()
    expect(s0.activeTurnId).toBeNull()

    // Act
    const result = editorReducer(s0, makeError('any-turn', 'unexpected failure'))

    // Assert: surfaced even with no active turn
    expect(result.phase).toBe<EditorPhase>('error')
    expect(result.error).toBe('unexpected failure')
    expect(result.activeTurnId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 21. savedRecordId — persistence across turns (regression tests)
//
// design_run_start DOES reset savedRecordId (new turn = new unsaved work).
// artifact_saved DOES clear activeTurnId (save is terminal for the turn, so
// the next design_run_start is unblocked even if design_run_complete is dropped).
// ---------------------------------------------------------------------------

describe('savedRecordId — reset by design_run_start', () => {
  it('savedRecordId is set after a successful artifact_saved and activeTurnId is cleared', () => {
    // Arrange: drive T1 through the full save flow
    // Note: artifact_saved clears activeTurnId (save is the terminal event for the turn).
    let s = initEditorState()
    s = editorReducer(s, makeStart('T1', null))
    s = editorReducer(s, makeFull('T1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('T1', true))
    s = editorReducer(s, makeSaved('T1', 'record-001', HASH_V1))

    // Assert: savedRecordId set, phase idle, activeTurnId cleared by artifact_saved
    expect(s.savedRecordId).toBe('record-001')
    expect(s.phase).toBe<EditorPhase>('idle')
    // artifact_saved clears activeTurnId — the turn is done
    expect(s.activeTurnId).toBeNull()
  })

  it('savedRecordId IS reset to null when a new design_run_start is dispatched', () => {
    // Arrange: T1 saves (activeTurnId cleared), then design_run_complete is a no-op
    let s = initEditorState()
    s = editorReducer(s, makeStart('T1', null))
    s = editorReducer(s, makeFull('T1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('T1', true))
    s = editorReducer(s, makeSaved('T1', 'record-001', HASH_V1))
    // activeTurnId is already null after saved; complete for T1 is a no-op
    s = editorReducer(s, makeComplete('T1'))
    expect(s.savedRecordId).toBe('record-001')
    expect(s.activeTurnId).toBeNull()

    // Act: start a new turn T2 with the current headVersionHash
    const s2 = editorReducer(s, makeStart('T2', s.headVersionHash))

    // Assert: savedRecordId is reset (design_run_start clears it — new unsaved work)
    expect(s2.savedRecordId).toBeNull()
    expect(s2.phase).toBe<EditorPhase>('streaming')
    expect(s2.activeTurnId).toBe('T2')
  })

  it('savedRecordId updates to new value when a second artifact_saved fires for T2', () => {
    // Arrange: T1 saves and completes, then T2 runs and saves with a different record ID
    let s = initEditorState()
    s = editorReducer(s, makeStart('T1', null))
    s = editorReducer(s, makeFull('T1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('T1', true))
    s = editorReducer(s, makeSaved('T1', 'record-001', HASH_V1))
    s = editorReducer(s, makeComplete('T1'))

    s = editorReducer(s, makeStart('T2', HASH_V1))
    s = editorReducer(s, makeFull('T2', SOURCE_V2))
    s = editorReducer(s, makeBuildStatus('T2', true))
    s = editorReducer(s, makeSaved('T2', 'record-002', HASH_V2))

    // Assert: new save record replaces the old one
    expect(s.savedRecordId).toBe('record-002')
    expect(s.phase).toBe<EditorPhase>('idle')
  })
})

// ---------------------------------------------------------------------------
// 22. lastBuild — reset by design_run_start and artifact_full (regression tests)
//
// design_run_start resets lastBuild to null (new turn = new unsaved work, prior
// build result is stale). artifact_full also resets lastBuild to null (new source
// invalidates any prior build result). A new build_status event then sets lastBuild.
// ---------------------------------------------------------------------------

describe('lastBuild — reset by design_run_start and artifact_full', () => {
  it('lastBuild is set after build_status(ok=false)', () => {
    // Arrange
    let s = initEditorState()
    s = editorReducer(s, makeStart('T1', null))
    s = editorReducer(s, makeFull('T1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('T1', false, ['TS2322'], [{ text: 'type error' }]))

    // Assert
    expect(s.phase).toBe<EditorPhase>('repair')
    expect(s.lastBuild).not.toBeNull()
    expect(s.lastBuild?.ok).toBe(false)
    expect(s.lastBuild?.diagnostics).toEqual(['TS2322'])
  })

  it('lastBuild is reset to null by design_run_start (new turn clears prior build)', () => {
    // Arrange: T1 ends in repair, complete it, start T2
    let s = initEditorState()
    s = editorReducer(s, makeStart('T1', null))
    s = editorReducer(s, makeFull('T1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('T1', false, ['TS2322'], [{ text: 'err' }]))
    s = editorReducer(s, makeComplete('T1'))

    // Act: start repair turn T2
    const s2 = editorReducer(s, makeStart('T2', HASH_V1))

    // Assert: lastBuild is reset to null by design_run_start (stale result cleared)
    expect(s2.lastBuild).toBeNull()
    expect(s2.savedRecordId).toBeNull()
  })

  it('lastBuild is reset to null by artifact_full (new source invalidates prior build)', () => {
    // Arrange: T1 builds with error, T2 starts, then T2 sends artifact_full
    let s = initEditorState()
    s = editorReducer(s, makeStart('T1', null))
    s = editorReducer(s, makeFull('T1', SOURCE_V1))
    const buildDiag = ['TS2322']
    s = editorReducer(s, makeBuildStatus('T1', false, buildDiag, [{ text: 'type mismatch' }]))
    s = editorReducer(s, makeComplete('T1'))

    s = editorReducer(s, makeStart('T2', HASH_V1))

    // Act: T2 sends new source (design_run_start already cleared lastBuild; artifact_full also clears)
    const afterFull = editorReducer(s, makeFull('T2', SOURCE_V2))

    // Assert: lastBuild is null — artifact_full resets it (new source invalidates prior build)
    expect(afterFull.lastBuild).toBeNull()
    expect(afterFull.headVersionHash).toBe(versionHash(SOURCE_V2))
    expect(afterFull.source).toBe(SOURCE_V2)
  })

  it('lastBuild is replaced by a new build_status result for T2', () => {
    // Arrange: T1 builds with error, T2 starts and builds with success
    let s = initEditorState()
    s = editorReducer(s, makeStart('T1', null))
    s = editorReducer(s, makeFull('T1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('T1', false, ['TS2322'], []))
    s = editorReducer(s, makeComplete('T1'))

    s = editorReducer(s, makeStart('T2', HASH_V1))
    s = editorReducer(s, makeFull('T2', SOURCE_V2))

    // Act: T2 succeeds at build
    const s2 = editorReducer(s, makeBuildStatus('T2', true, [], []))

    // Assert: lastBuild is now T2's result
    expect(s2.lastBuild?.ok).toBe(true)
    expect(s2.lastBuild?.diagnostics).toEqual([])
    expect(s2.phase).toBe<EditorPhase>('preview')
  })
})

// ---------------------------------------------------------------------------
// 23. design_run_complete mid-stream — transitions to error
//
// When design_run_complete arrives while phase is 'streaming' (no terminal
// build/preview received), the reducer transitions to the error phase. The turn
// ended without producing a usable artifact, which is an error condition.
// From terminal phases (preview / repair / idle), complete just clears activeTurnId.
// ---------------------------------------------------------------------------

describe('design_run_complete mid-stream — transitions to error', () => {
  it('complete during streaming transitions to error phase (turn ended without artifact)', () => {
    // Arrange: active streaming turn
    let s = initEditorState()
    s = editorReducer(s, makeStart('T1', null))
    expect(s.phase).toBe<EditorPhase>('streaming')

    // Act: complete arrives before artifact_full
    const result = editorReducer(s, makeComplete('T1'))

    // Assert: error phase, activeTurnId cleared, error message mentions the turn
    expect(result.phase).toBe<EditorPhase>('error')
    expect(result.activeTurnId).toBeNull()
    expect(result.error).toContain('T1')
  })

  it('source and history are unchanged when complete arrives mid-stream', () => {
    // Arrange
    let s = initEditorState()
    s = editorReducer(s, makeStart('T1', null))
    s = editorReducer(s, makeDelta('T1', 'partial'))
    const sourceBefore = s.source
    const historyBefore = s.history

    // Act
    const result = editorReducer(s, makeComplete('T1'))

    // Assert: source and history unchanged
    expect(result.source).toBe(sourceBefore)
    expect(result.history).toStrictEqual(historyBefore)
  })

  it('complete after build_status(ok) keeps preview phase and clears activeTurnId', () => {
    // Arrange: full happy path up to preview
    let s = initEditorState()
    s = editorReducer(s, makeStart('T1', null))
    s = editorReducer(s, makeFull('T1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('T1', true))
    expect(s.phase).toBe<EditorPhase>('preview')

    // Act: complete arrives after a successful build (no artifact_saved in between)
    const result = editorReducer(s, makeComplete('T1'))

    // Assert: preview phase preserved, activeTurnId cleared
    expect(result.phase).toBe<EditorPhase>('preview')
    expect(result.activeTurnId).toBeNull()
  })

  it('complete for a non-active turn is a no-op (same reference)', () => {
    // Arrange: active turn is T1
    let s = initEditorState()
    s = editorReducer(s, makeStart('T1', null))
    s = editorReducer(s, makeFull('T1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('T1', true))

    // Act: complete with a different turnId
    const result = editorReducer(s, makeComplete('stale-turn'))

    // Assert: no-op — same reference
    expect(result).toBe(s)
  })
})

// ---------------------------------------------------------------------------
// 24. initEditorState — hardened invariant tests (regression)
// ---------------------------------------------------------------------------

describe('initEditorState — hardened invariants', () => {
  it('computes headVersionHash from source when source is provided', () => {
    // Arrange + Act
    const s = initEditorState({ source: '<div/>', language: 'html' })

    // Assert
    expect(s.headVersionHash).toBe(versionHash('<div/>'))
  })

  it('headVersionHash equals versionHash(source) for any non-empty source', () => {
    const s = initEditorState({ source: SOURCE_V2, language: 'html' })
    expect(s.headVersionHash).toBe(versionHash(s.source))
  })

  it('no-arg call returns empty source and empty headVersionHash', () => {
    const s = initEditorState()
    expect(s.source).toBe('')
    expect(s.headVersionHash).toBe('')
  })

  it('no-arg call returns empty history array', () => {
    const s = initEditorState()
    expect(s.history).toEqual([])
  })

  it('caller-supplied empty history stays empty (head is NOT auto-appended to history)', () => {
    // The reducer does not auto-append the initial source to history.
    // History is only populated by artifact_full events during turns.
    const s = initEditorState({ source: SOURCE_V1, history: [] })
    expect(s.history).toHaveLength(0)
  })

  it('caller-supplied headVersionHash is respected when provided explicitly', () => {
    // When the caller supplies both source and headVersionHash (e.g. hydrating
    // from persisted state), headVersionHash is taken as-is.
    const explicitHash = 'cafebabe'
    const s = initEditorState({ source: SOURCE_V1, headVersionHash: explicitHash })
    expect(s.headVersionHash).toBe(explicitHash)
  })

  it('headVersionHash is computed from source when headVersionHash is NOT supplied', () => {
    const s = initEditorState({ source: SOURCE_V1 })
    expect(s.headVersionHash).toBe(versionHash(SOURCE_V1))
    expect(s.headVersionHash).toBe(HASH_V1)
  })
})

// ---------------------------------------------------------------------------
// 25. No-op coverage — build_status and artifact_full with no active turn
//
// When activeTurnId is null, any event whose handler checks turnId === activeTurnId
// will see the mismatch and return the same state reference unchanged.
// ---------------------------------------------------------------------------

describe('no-op: build_status and artifact_full when activeTurnId is null', () => {
  it('build_status dispatched on a fresh idle state returns the same reference', () => {
    // Arrange: fresh state with no active turn
    const s0 = initEditorState()
    expect(s0.activeTurnId).toBeNull()

    // Act
    const result = editorReducer(s0, makeBuildStatus('any-turn', true))

    // Assert: same reference (no-op)
    expect(result).toBe(s0)
  })

  it('artifact_full dispatched on a fresh idle state returns the same reference', () => {
    // Arrange: fresh state with no active turn
    const s0 = initEditorState()
    expect(s0.activeTurnId).toBeNull()

    // Act
    const result = editorReducer(s0, makeFull('any-turn', SOURCE_V1))

    // Assert: same reference (no-op)
    expect(result).toBe(s0)
  })

  it('build_status after turn completes (activeTurnId cleared) returns same reference', () => {
    // Arrange: complete a turn so activeTurnId becomes null
    let s = initEditorState()
    s = editorReducer(s, makeStart('T1', null))
    s = editorReducer(s, makeFull('T1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('T1', true))
    s = editorReducer(s, makeComplete('T1'))
    expect(s.activeTurnId).toBeNull()

    // Act: stale build_status for the now-completed turn
    const result = editorReducer(s, makeBuildStatus('T1', false))

    // Assert: no-op since T1 is no longer active
    expect(result).toBe(s)
  })

  it('artifact_full after turn completes returns same reference', () => {
    // Arrange: complete a turn
    let s = initEditorState()
    s = editorReducer(s, makeStart('T1', null))
    s = editorReducer(s, makeFull('T1', SOURCE_V1))
    s = editorReducer(s, makeBuildStatus('T1', true))
    s = editorReducer(s, makeComplete('T1'))
    expect(s.activeTurnId).toBeNull()

    // Act: stale artifact_full for the now-completed turn
    const result = editorReducer(s, makeFull('T1', SOURCE_V2))

    // Assert: no-op
    expect(result).toBe(s)
  })
})
