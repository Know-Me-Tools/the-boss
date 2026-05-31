/**
 * designOrchestrator.ts — change-004-artifact-design-orchestrator
 *
 * Drives ONE design turn: prompt → generate → validate → build → events.
 *
 * Design decisions:
 *
 * 1. PURE CORE — This module has no imports from @renderer/services, window.*,
 *    or console.*. All I/O is injected via ArtifactOrchestratorDeps. The thin
 *    default-wired convenience is kept in a SEPARATE file (designOrchestrator.default.ts)
 *    so the core remains fully unit-testable with mocks.
 *
 * 2. BASE HASH NULL SEMANTICS — When state.source is '' (no prior source),
 *    headVersionHash is '' (per initEditorState). We pass null as baseVersionHash
 *    in design_run_start so the reducer does not reject the first turn on a
 *    stale-anchor mismatch. The reducer accepts null as "no prior version, any
 *    base is valid." Document: treat '' source ↔ null base.
 *
 * 3. JSON EXTRACTION — Models often wrap JSON in ```json fences or prose.
 *    extractJson strips a single outermost code-fence block before JSON.parse.
 *    If the result still fails JSON.parse, a design_run_error is emitted.
 *
 * 4. GRACEFUL GENERATE THROWS — If deps.generate rejects, the error is caught
 *    and surfaced as a design_run_error. The orchestrator never rejects.
 *
 * 5. HTML BUILD PATH — runBuildFeedback handles html synchronously (no
 *    compileReact call). The injected compileReact is only invoked for tsx/jsx.
 *
 * 6. IMMUTABILITY — All state transitions go through editorReducer (pure).
 *    Local `events` array is built up via push (internal accumulator, never
 *    returned by reference after the function returns), and the returned
 *    events array is a frozen snapshot.
 */

import type { ArtifactDesignEvent, ArtifactSourceLanguage } from './designProtocol'
import { ArtifactDesignTurnPayloadSchema } from './designProtocol'
import { runBuildFeedback } from './buildFeedback'
import type { CompileReactFn } from './buildFeedback'
import { editorReducer } from './editorReducer'
import type { EditorState } from './editorReducer'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { CompileReactFn }

export type ArtifactGenerateFn = (args: { prompt: string; content: string }) => Promise<string>

export interface ArtifactOrchestratorDeps {
  generate: ArtifactGenerateFn
  compileReact: CompileReactFn
}

export interface RunDesignTurnInput {
  /** Current editor state (head source + headVersionHash). */
  state: EditorState
  /** The user's natural-language edit/create request. */
  request: string
  /** Target language for this artifact. */
  language: ArtifactSourceLanguage
  /** Caller-supplied stable id for this turn. */
  turnId: string
  title?: string
}

export interface RunDesignTurnResult {
  /** Ordered events emitted this turn, applied to the reducer in sequence. */
  events: ArtifactDesignEvent[]
  /** Reducer state after applying all events. */
  state: EditorState
}

// ---------------------------------------------------------------------------
// buildTurnPrompt — pure helper; separately unit-tested
// ---------------------------------------------------------------------------

export interface BuildTurnPromptInput {
  state: EditorState
  request: string
  language: ArtifactSourceLanguage
  turnId: string
  title?: string
}

export interface BuildTurnPromptResult {
  prompt: string
  content: string
}

export function buildTurnPrompt(input: BuildTurnPromptInput): BuildTurnPromptResult {
  const { state, request, language } = input

  const diagnosticsSection =
    state.lastBuild !== null && !state.lastBuild.ok && state.lastBuild.diagnostics.length > 0
      ? [
          '',
          'The previous build failed with the following diagnostics. Fix these errors in your response:',
          ...state.lastBuild.diagnostics.map((d) => `  - ${d}`)
        ].join('\n')
      : ''

  const prompt = [
    `You are an expert ${language} developer writing a complete, self-contained artifact.`,
    '',
    'Return ONLY a valid JSON object — no prose, no markdown, no explanation — with this exact shape:',
    '  { "source": "<the complete file contents>", "language": "<html|tsx|jsx>", "notes": "<optional>" }',
    '',
    `The language field MUST be "${language}".`,
    'The source field MUST be the COMPLETE new file contents (full-file rewrite, not a diff or partial).',
    '',
    `User request: ${request}`,
    diagnosticsSection
  ]
    .join('\n')
    .trimEnd()

  const content = state.source !== '' ? `Current source:\n${state.source}` : 'No existing source — create from scratch.'

  return { prompt, content }
}

// ---------------------------------------------------------------------------
// extractJson — pure helper; strips optional code-fence wrapper
// ---------------------------------------------------------------------------

// Matches a ```json or ``` fenced block. Newlines around the body are OPTIONAL
// so single-line fences (```json {…} ```) and missing-trailing-newline blocks
// (```json\n{…}```) both match — models emit all of these. Captures the body.
const FENCE_RE = /```(?:json)?[ \t]*\n?([\s\S]*?)\n?[ \t]*```/

export function extractJson(text: string): string {
  const match = FENCE_RE.exec(text)
  if (match !== null) {
    return match[1].trim()
  }

  // Fallback for unfenced prose wrapping ("Here is the JSON: {…}\nEnjoy!").
  // Slice from the first '{' to the last '}' so JSON.parse gets a clean object.
  // The schema validation layer rejects anything malformed that slips through.
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last > first) {
    return text.slice(first, last + 1).trim()
  }

  return text.trim()
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}

function resolveBaseVersionHash(state: EditorState): string | null {
  // When no source has been applied yet, headVersionHash is '' (per initEditorState).
  // Treat '' as "no prior version" and pass null so the first turn is not rejected
  // by the reducer's stale-anchor guard.
  return state.source === '' ? null : state.headVersionHash
}

// ---------------------------------------------------------------------------
// parsePayload — validates model output and returns payload or error string
// ---------------------------------------------------------------------------

function parsePayload(
  raw: string
): { ok: true; source: string; language: ArtifactSourceLanguage } | { ok: false; message: string } {
  const extracted = extractJson(raw)
  if (extracted === '') {
    return { ok: false, message: 'Model returned empty response' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(extracted)
  } catch {
    return { ok: false, message: `Model response is not valid JSON: ${extracted.slice(0, 120)}` }
  }

  const result = ArtifactDesignTurnPayloadSchema.safeParse(parsed)
  if (!result.success) {
    return {
      ok: false,
      message: `Model response failed schema validation: ${result.error.issues.map((i) => i.message).join('; ')}`
    }
  }

  return { ok: true, source: result.data.source, language: result.data.language }
}

// ---------------------------------------------------------------------------
// runDesignTurn — main orchestration function
// ---------------------------------------------------------------------------

export async function runDesignTurn(
  input: RunDesignTurnInput,
  deps: ArtifactOrchestratorDeps
): Promise<RunDesignTurnResult> {
  const { state: initialState, request, language, turnId, title } = input

  // Internal mutable accumulator — only pushed to; the frozen snapshot is
  // returned at the end. This satisfies the immutability requirement: the
  // returned array is never the same reference as this accumulator.
  const emittedEvents: ArtifactDesignEvent[] = []
  let currentState = initialState

  function emit(event: ArtifactDesignEvent): void {
    emittedEvents.push(event)
    currentState = editorReducer(currentState, event)
  }

  // Step 1: Emit design_run_start
  emit({
    kind: 'design_run_start',
    turnId,
    baseVersionHash: resolveBaseVersionHash(initialState)
  })

  // Step 2: Build prompt and call generate (may throw)
  let rawResponse: string
  try {
    const { prompt, content } = buildTurnPrompt({ state: initialState, request, language, turnId, title })
    rawResponse = await deps.generate({ prompt, content })
  } catch (err: unknown) {
    emit({ kind: 'design_run_error', turnId, message: getErrorMessage(err) })
    return { events: [...emittedEvents], state: currentState }
  }

  // Step 3: Parse and validate model response
  const payloadResult = parsePayload(rawResponse)
  if (!payloadResult.ok) {
    emit({ kind: 'design_run_error', turnId, message: payloadResult.message })
    return { events: [...emittedEvents], state: currentState }
  }

  // Step 4: Emit artifact_full (reducer updates source, headVersionHash, phase→building)
  emit({
    kind: 'artifact_full',
    turnId,
    source: payloadResult.source,
    language: payloadResult.language
  })

  // Step 5: Run build feedback
  const buildEvent = await runBuildFeedback(
    { turnId, source: payloadResult.source, language: payloadResult.language, title },
    { compileReact: deps.compileReact }
  )
  emit(buildEvent)

  // Step 6: Emit design_run_complete
  emit({ kind: 'design_run_complete', turnId })

  return { events: [...emittedEvents], state: currentState }
}
