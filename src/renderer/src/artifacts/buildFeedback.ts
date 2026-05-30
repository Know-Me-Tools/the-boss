/**
 * buildFeedback — change-003-artifact-build-feedback-seam
 *
 * Pure, side-effect-free module that runs a build/validate pass for an
 * artifact source and produces a `build_status` ArtifactDesignEvent.
 *
 * Design decisions:
 *
 * 1. DEPENDENCY INJECTION — The IPC call (`compileReact`) is injected via
 *    `BuildFeedbackDeps` so this module is fully unit-testable with mocks and
 *    never references `window.api` directly.
 *
 * 2. ERRORS-FROM-DIAGNOSTICS MAPPING (React path) — The compile API returns a
 *    single `diagnostics: string[]` array; there is no separate `errors` field.
 *    When `ok === false` each diagnostic string is mapped to `{ text: diagnostic }`
 *    to give the orchestrator/UI a structured error list. When `ok === true`
 *    diagnostics are passed through as-is (may be warnings) but `errors` stays
 *    empty — warnings do not gate a successful build.
 *
 * 3. IPC-THROW SAFETY — If `compileReact` rejects (network/IPC failure), the
 *    rejection is caught and returned as a `build_status{ ok: false }` event.
 *    A build failure is data, not an exception; the seam must never reject.
 *
 * 4. HTML VALIDATION STRATEGY — HTML runs a lightweight, synchronous, pure-string
 *    heuristic validator. Real runtime errors surface in the preview iframe later;
 *    this is a fast pre-check that only flags clearly-broken HTML to avoid false
 *    positives that would block the design loop. Checks performed:
 *      a) Non-empty after trim.
 *      b) No stray `<` with no matching `>` (angle-bracket balance heuristic).
 *      c) Balanced open/close tag count for void-free paired tags (conservative).
 *      d) `<script` appears with closing `</script>`.
 *      e) `<style` appears with closing `</style>`.
 *    No DOM/jsdom dependency — fully deterministic for a given input string.
 */

import type { ArtifactDesignEvent, ArtifactSourceLanguage } from './designProtocol'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CompileReactFn = (request: {
  source: string
  title?: string
}) => Promise<{ ok: boolean; script: string; diagnostics: string[] }>

export interface BuildFeedbackDeps {
  /** Injected at the call site — must be window.api.artifacts.compileReact in production. */
  compileReact: CompileReactFn
}

export interface BuildFeedbackInput {
  turnId: string
  source: string
  language: ArtifactSourceLanguage
  title?: string
}

// Convenience alias for the specific event variant this module produces.
type BuildStatusEvent = Extract<ArtifactDesignEvent, { kind: 'build_status' }>

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'Unknown error'
}

function makeBuildStatus(
  turnId: string,
  ok: boolean,
  diagnostics: readonly string[],
  errors: readonly { readonly text: string }[]
): BuildStatusEvent {
  return { kind: 'build_status', turnId, ok, diagnostics, errors }
}

// ---------------------------------------------------------------------------
// HTML validation — synchronous, pure-string heuristics
// ---------------------------------------------------------------------------

interface ValidationIssue {
  text: string
}

function validateHtml(source: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const trimmed = source.trim()

  // Check a: non-empty after trim
  if (trimmed.length === 0) {
    issues.push({ text: 'HTML source is empty — nothing to render.' })
    return issues
  }

  // NOTE: we deliberately do NOT scan for "stray `<`" at the character level.
  // A bare `<` is legal inside text content and is extremely common inside
  // <script> blocks (`a < b`, arrow functions `() =>`, generics). Flagging it
  // produced false-positive build failures that would block the iterate loop
  // on valid HTML+JS artifacts. We rely only on the conservative paired-tag
  // and <script>/<style> balance checks below, which do not false-positive on
  // JS operators.

  // Check e: paired-tag balance for common block elements.
  // Void elements (br, hr, img, input, meta, link, area, base, col, embed,
  // param, source, track, wbr) are excluded since they have no closing tag.
  // We only flag clear imbalances (open >> close) as broken HTML; close > open
  // can legitimately occur in fragments, so we only flag the definite case.
  const BLOCK_TAGS = [
    'div',
    'p',
    'section',
    'article',
    'header',
    'footer',
    'main',
    'nav',
    'aside',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'table',
    'thead',
    'tbody',
    'tr',
    'td',
    'th',
    'span',
    'a',
    'button',
    'form',
    'label',
    'textarea',
    'select',
    'option'
  ]
  const lcTrimmed = trimmed.toLowerCase()
  for (const tag of BLOCK_TAGS) {
    const openPattern = new RegExp(`<${tag}[\\s>]`, 'g')
    const closePattern = new RegExp(`<\\/${tag}>`, 'g')
    const opens = (lcTrimmed.match(openPattern) ?? []).length
    const closes = (lcTrimmed.match(closePattern) ?? []).length
    if (opens > closes) {
      issues.push({ text: `Malformed HTML: <${tag}> opened ${opens} time(s) but closed ${closes} time(s).` })
    }
  }

  if (issues.length > 0) return issues

  // Check f: <script> must have </script>
  const lcSource = trimmed.toLowerCase()
  const scriptOpenCount = (lcSource.match(/<script[\s>]/g) ?? []).length
  const scriptCloseCount = (lcSource.match(/<\/script>/g) ?? []).length
  if (scriptOpenCount !== scriptCloseCount) {
    issues.push({
      text: `Malformed HTML: found ${scriptOpenCount} <script> tag(s) but ${scriptCloseCount} </script> tag(s).`
    })
  }

  // Check d: <style> must have </style>
  const styleOpenCount = (lcSource.match(/<style[\s>]/g) ?? []).length
  const styleCloseCount = (lcSource.match(/<\/style>/g) ?? []).length
  if (styleOpenCount !== styleCloseCount) {
    issues.push({
      text: `Malformed HTML: found ${styleOpenCount} <style> tag(s) but ${styleCloseCount} </style> tag(s).`
    })
  }

  return issues
}

// ---------------------------------------------------------------------------
// React path
// ---------------------------------------------------------------------------

async function runReactBuildFeedback(input: BuildFeedbackInput, deps: BuildFeedbackDeps): Promise<BuildStatusEvent> {
  try {
    const response = await deps.compileReact({ source: input.source, title: input.title })
    const errors = response.ok ? [] : response.diagnostics.map((d) => ({ text: d }))
    return makeBuildStatus(input.turnId, response.ok, response.diagnostics, errors)
  } catch (err: unknown) {
    const message = getErrorMessage(err)
    return makeBuildStatus(input.turnId, false, [message], [{ text: message }])
  }
}

// ---------------------------------------------------------------------------
// HTML path
// ---------------------------------------------------------------------------

function runHtmlBuildFeedback(input: BuildFeedbackInput): BuildStatusEvent {
  const issues = validateHtml(input.source)
  const ok = issues.length === 0
  const diagnostics = issues.map((i) => i.text)
  const errors = issues
  return makeBuildStatus(input.turnId, ok, diagnostics, errors)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runBuildFeedback(input: BuildFeedbackInput, deps: BuildFeedbackDeps): Promise<BuildStatusEvent> {
  if (input.language === 'tsx' || input.language === 'jsx') {
    return runReactBuildFeedback(input, deps)
  }
  return runHtmlBuildFeedback(input)
}
