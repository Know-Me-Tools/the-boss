# change-003-artifact-build-feedback-seam

Status: DONE
Priority: P0
Assigned backend: claude-code (subagent-driven TDD)
Recommended agent: tdd-guide → typescript-reviewer
Depends on: change-001-artifact-design-protocol-types
Phase: artifact-editor-iterative-design-protocol

## Goal

Provide the build/validate pass that closes "edit again until functional" by emitting a
`build_status` event. Reuse the existing seam: `window.api.artifacts.compileReact(request)`.

CORRECTION (verified against code): the real response shape is
`CompileReactArtifactResponse = { ok: boolean; script: string; diagnostics: string[] }`
— there is NO `errors` field (the original assumption of `{ code, diagnostics, errors }`
was wrong). The `build_status` event's `errors: {text}[]` is derived (empty on success;
on failure, wrap diagnostics or leave empty — see decision in outcome). HTML artifacts
get a lighter validation pass.

## Tasks

- [x] Add `src/renderer/src/artifacts/buildFeedback.ts` (`runBuildFeedback(input, deps)`).
- [x] React: call injected `deps.compileReact` (= `window.api.artifacts.compileReact`)
      and map `{ ok, script, diagnostics }` → `build_status{ ok, diagnostics, errors }`
      (errors derived from diagnostics on failure; `[]` on success). IPC throw → resolves
      to `ok:false` (build failure is data, never an exception).
- [x] HTML: light, deterministic, pure-string validation → `build_status` (conservative
      paired-tag + `<script>`/`<style>` balance + empty checks).
- [x] Unit tests with mocked compile fn: ok / diagnostics-only / hard errors / IPC throw;
      HTML valid / valid-with-JS-operators / unclosed tag / unclosed script / empty.

## Acceptance Criteria

- [x] React mapping verified against the REAL `CompileReactArtifactResponse`
      (`{ ok, script, diagnostics }` — no `errors` field).
- [x] HTML validation deterministic and does NOT false-positive on `<`/`>`/`=>` in JS.
- [x] No UI; pure module, IPC injected/mockable (no `window.` at module scope).

## Verification

- `pnpm test:renderer …/buildFeedback.test.ts` — 22/22 pass (Node 24.16.0).
- Biome clean; no `console.*`/`window.`/forbidden imports; tsgo (web) no errors from this file.

## Outcome

- File: `src/renderer/src/artifacts/buildFeedback.ts` + test.
- Two-stage review (tdd-guide → typescript-reviewer). Reviewer caught a HIGH bug: the
  initial character-level "stray `<`" HTML check false-positived on JS comparison
  operators / arrow functions inside `<script>`, which would block the iterate loop on
  valid HTML+JS artifacts — and a test that locked in that bug. FIXED: removed the
  stray-`<` scanner; kept conservative tag-balance + script/style-pairing + empty checks;
  replaced the bad test and added regression tests (bare `<` in text, `<script>` with
  `<`/`>`/`=>`, unclosed `<script>`).
- QA gate (artifact-refiner): skipped — 2 files modified, below the <3-file threshold.
