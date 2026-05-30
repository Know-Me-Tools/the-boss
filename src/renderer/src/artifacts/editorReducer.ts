import type { ArtifactSourceLanguage } from '@shared/artifacts'

import type { ArtifactDesignEvent } from './designProtocol'
import { versionHash } from './designProtocol'

// ---------------------------------------------------------------------------
// EditorPhase — all phases of the iterative artifact editor state machine.
//
// Flow: idle → streaming → building → preview → idle
//                                   ↘ repair → (next turn) → streaming
// error is recoverable via a new design_run_start.
//
// Note: `prompting` and `applying` and `saving` are modelled as discrete phases
// in the type union for extensibility and for React-layer visibility, but the
// reducer transitions through them atomically when there is no async gap
// (i.e. design_run_start lands directly in `streaming`; artifact_full lands
// directly in `building`). The UI may show these transiently.
// ---------------------------------------------------------------------------

export type EditorPhase =
  | 'idle'
  | 'prompting'
  | 'streaming'
  | 'applying'
  | 'building'
  | 'preview'
  | 'repair'
  | 'saving'
  | 'error'

// ---------------------------------------------------------------------------
// HistoryEntry — a committed source version recorded on each artifact_full.
// History is append-only; entries are never removed or mutated.
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  readonly versionHash: string
  readonly source: string
}

// ---------------------------------------------------------------------------
// LastBuild — snapshot of the most recent build_status event payload.
// ---------------------------------------------------------------------------

export interface LastBuild {
  readonly ok: boolean
  readonly diagnostics: readonly string[]
  readonly errors: readonly { readonly text: string }[]
}

// ---------------------------------------------------------------------------
// EditorState — the complete, serialisable, immutable state of the editor.
//
// All fields are readonly. Transitions produce new objects via spread; the
// input state is never mutated.
// ---------------------------------------------------------------------------

export interface EditorState {
  readonly phase: EditorPhase
  readonly source: string
  readonly language: ArtifactSourceLanguage
  /** FNV-1a anchor of `source`; '' when no source has been applied yet. */
  readonly headVersionHash: string
  readonly activeTurnId: string | null
  /** Accumulates artifact_text_delta chunks for the active turn. */
  readonly streamingText: string
  readonly lastBuild: LastBuild | null
  readonly savedRecordId: string | null
  readonly error: string | null
  /** Append-only ordered list of applied source versions. */
  readonly history: readonly HistoryEntry[]
}

// ---------------------------------------------------------------------------
// initEditorState — construct a valid initial state, optionally seeded.
//
// When `source` is provided in the partial init, `headVersionHash` is computed
// automatically from it to preserve the invariant headVersionHash = versionHash(source).
// ---------------------------------------------------------------------------

export function initEditorState(init?: Partial<EditorState>): EditorState {
  const source = init?.source ?? ''
  const computedHash = source === '' ? '' : versionHash(source)

  return {
    phase: 'idle',
    source,
    language: 'html',
    headVersionHash: computedHash,
    activeTurnId: null,
    streamingText: '',
    lastBuild: null,
    savedRecordId: null,
    error: null,
    history: [],
    // Spread overrides AFTER we set computed defaults so callers can still
    // supply an explicit headVersionHash if they need to (e.g. hydrating from
    // persisted state where the source+hash are already consistent).
    ...init,
    // Re-apply source so headVersionHash is always driven from source if
    // the caller supplied source but not headVersionHash.
    source,
    headVersionHash: init?.headVersionHash !== undefined ? init.headVersionHash : computedHash
  }
}

// ---------------------------------------------------------------------------
// editorReducer — pure state transition function.
//
// Contract:
//  - Never mutates `state` or `event`.
//  - Same (state, event) → structurally equal result (referential transparency).
//  - Invalid or inapplicable events are either a documented no-op or produce
//    an error state; they never silently corrupt state.
// ---------------------------------------------------------------------------

export function editorReducer(state: EditorState, event: ArtifactDesignEvent): EditorState {
  switch (event.kind) {
    case 'design_run_start':
      return handleRunStart(state, event)
    case 'artifact_text_delta':
      return handleTextDelta(state, event)
    case 'artifact_full':
      return handleArtifactFull(state, event)
    case 'build_status':
      return handleBuildStatus(state, event)
    case 'artifact_saved':
      return handleArtifactSaved(state, event)
    case 'design_run_complete':
      return handleRunComplete(state, event)
    case 'design_run_error':
      return handleRunError(state, event)
    default: {
      // Exhaustiveness guard: adding a new ArtifactDesignEvent kind without a
      // handler is a compile error here.
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}

// ---------------------------------------------------------------------------
// Transition handlers — each is a pure function <50 lines.
// ---------------------------------------------------------------------------

function handleRunStart(
  state: EditorState,
  event: Extract<ArtifactDesignEvent, { kind: 'design_run_start' }>
): EditorState {
  // Guard: another turn is already in-flight → reject.
  // Design decision: we reject (go to error) rather than silently replace the
  // active turn. This surfaces orchestration bugs and prevents a racing second
  // turn from clobbering in-progress streaming state.
  if (state.activeTurnId !== null) {
    return toError(
      state,
      `design_run_start for turn '${event.turnId}' rejected: turn '${state.activeTurnId}' is still active`
    )
  }

  // Guard: stale-turn rejection.
  // When baseVersionHash is non-null, it must match the current head so we do
  // not apply an edit that was authored against an older version of the source.
  if (event.baseVersionHash !== null && event.baseVersionHash !== state.headVersionHash) {
    return toError(
      state,
      `design_run_start for turn '${event.turnId}' rejected: baseVersionHash '${event.baseVersionHash}' does not match current headVersionHash '${state.headVersionHash}'`
    )
  }

  // Design decision: design_run_start jumps directly to `streaming` (not
  // `prompting`) because the model call is fired before the event arrives;
  // the first token may land immediately. `prompting` is reserved for the
  // brief UI moment before the model call is issued, which the orchestration
  // layer sets explicitly if needed — the reducer does not linger there.
  return {
    ...state,
    phase: 'streaming',
    activeTurnId: event.turnId,
    streamingText: '',
    error: null,
    // A new turn is new unsaved work: drop the prior turn's build result and
    // save marker so the repair layer / UI never read stale values for the
    // turn that is just starting.
    lastBuild: null,
    savedRecordId: null
  }
}

function handleTextDelta(
  state: EditorState,
  event: Extract<ArtifactDesignEvent, { kind: 'artifact_text_delta' }>
): EditorState {
  // Ignore deltas for a turn that is not the active one (stale / out-of-order).
  if (event.turnId !== state.activeTurnId) {
    return state
  }

  return {
    ...state,
    streamingText: state.streamingText + event.text
  }
}

function handleArtifactFull(
  state: EditorState,
  event: Extract<ArtifactDesignEvent, { kind: 'artifact_full' }>
): EditorState {
  if (event.turnId !== state.activeTurnId) {
    return state
  }

  const newHash = versionHash(event.source)
  const newHistoryEntry: HistoryEntry = { versionHash: newHash, source: event.source }

  // Design decision: artifact_full jumps directly to `building` (skipping
  // `applying` as a discrete async phase) because source-swap in the reducer
  // is synchronous — `applying` is the label for the conceptual moment between
  // "source accepted" and "build triggered". The external orchestrator reads
  // the `building` phase as the signal to fire ArtifactService.compileReactArtifact.
  return {
    ...state,
    phase: 'building',
    source: event.source,
    language: event.language,
    headVersionHash: newHash,
    streamingText: '',
    // New source ⇒ any prior build result no longer describes head.
    lastBuild: null,
    history: [...state.history, newHistoryEntry]
  }
}

function handleBuildStatus(
  state: EditorState,
  event: Extract<ArtifactDesignEvent, { kind: 'build_status' }>
): EditorState {
  if (event.turnId !== state.activeTurnId) {
    return state
  }

  const lastBuild: LastBuild = {
    ok: event.ok,
    diagnostics: event.diagnostics,
    errors: event.errors
  }

  // ok → preview (user can inspect/accept the result).
  // !ok → repair (ready to loop back into prompting with build feedback).
  return {
    ...state,
    phase: event.ok ? 'preview' : 'repair',
    lastBuild
  }
}

function handleArtifactSaved(
  state: EditorState,
  event: Extract<ArtifactDesignEvent, { kind: 'artifact_saved' }>
): EditorState {
  if (event.turnId !== state.activeTurnId) {
    return state
  }

  // Guard: versionHash in the save event must match the current head.
  // A mismatch means the save resolved against a stale snapshot — treat as error
  // rather than silently recording a wrong recordId against the current source.
  if (event.versionHash !== state.headVersionHash) {
    return toError(
      state,
      `artifact_saved for turn '${event.turnId}' rejected: versionHash '${event.versionHash}' does not match headVersionHash '${state.headVersionHash}'`
    )
  }

  // Design decision: artifact_saved → idle (not saving → idle as two steps)
  // because the save is the terminal confirmation event; by the time the reducer
  // sees it, the save has already completed externally. The `saving` phase is
  // available for the orchestrator to set before issuing the save call.
  //
  // Clear activeTurnId here too: the save is terminal for the turn, so the
  // editor must accept a subsequent design_run_start even if design_run_complete
  // is dropped or arrives out of order. (Otherwise the next turn is wrongly
  // rejected as "turn still active".)
  return {
    ...state,
    phase: 'idle',
    savedRecordId: event.recordId,
    activeTurnId: null
  }
}

function handleRunComplete(
  state: EditorState,
  event: Extract<ArtifactDesignEvent, { kind: 'design_run_complete' }>
): EditorState {
  if (event.turnId !== state.activeTurnId) {
    return state
  }

  // If the turn reached a terminal phase (preview / repair / idle), just clear
  // the active turn and keep that phase. If complete arrives mid-stream
  // (streaming / building / prompting / applying / saving), the turn ended
  // without producing a usable artifact — surface that as an error rather than
  // stranding the machine in a non-terminal phase whose driving turn is gone.
  const terminal = state.phase === 'preview' || state.phase === 'repair' || state.phase === 'idle'
  if (terminal) {
    return { ...state, activeTurnId: null }
  }
  return toError(state, `Turn '${event.turnId}' completed without producing an artifact`)
}

function handleRunError(
  state: EditorState,
  event: Extract<ArtifactDesignEvent, { kind: 'design_run_error' }>
): EditorState {
  // Ignore a stale/late error for a turn that is no longer active while a
  // different turn IS active — otherwise an aborted turn's late failure would
  // wrongly kill the newer in-flight turn. When no turn is active, surface the
  // error defensively (it cannot clobber active work).
  if (state.activeTurnId !== null && event.turnId !== state.activeTurnId) {
    return state
  }
  return toError(state, event.message)
}

// ---------------------------------------------------------------------------
// toError — shared helper to transition any state to the error phase.
// ---------------------------------------------------------------------------

function toError(state: EditorState, message: string): EditorState {
  return {
    ...state,
    phase: 'error',
    error: message,
    activeTurnId: null
  }
}
