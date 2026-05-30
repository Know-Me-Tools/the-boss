# change-001-artifact-design-protocol-types

Status: DONE
Priority: P0
Assigned backend: claude-code (subagent-driven TDD)
Recommended agent: tdd-guide → typescript-reviewer
Depends on: —
Phase: artifact-editor-iterative-design-protocol

## Goal

Define the renderer-local typed artifact-design event protocol and the structured-output
payload schema that the chat model returns each turn. Event kinds mirror
`CanonicalAgentEvent` (`protocols/canonicalEvents.ts`) so a later promotion to the real
AG-UI mapper is mechanical. Full-file-rewrite-per-turn transport, with a version-hash
anchor in the protocol from day one.

## Tasks

- [x] Add `src/renderer/src/artifacts/designProtocol.ts` with the `ArtifactDesignEvent`
      discriminated union (`design_run_start`, `artifact_text_delta`, `artifact_full`,
      `build_status`, `artifact_saved`, `design_run_complete`, `design_run_error`).
      (`build_status` arrays are `readonly`; protocol-ordering + AG-UI divergence documented.)
- [x] Add a Zod schema for the model's structured-output payload `{ source, language, notes? }`
      reusing `ArtifactSourceLanguageSchema` from `@shared/artifacts`.
- [x] Add a `versionHash(source)` helper (FNV-1a 32-bit, pure/sync) used to anchor turns.
- [x] Unit tests: valid/invalid payloads, hash stability + pinned values, exhaustive union typing.

## Acceptance Criteria

- [x] Union + schema + hash helper exported and unit-tested (27/27 tests pass).
- [x] No UI, no model calls, no main-process changes.
- [x] Event kind names mirror `CanonicalAgentEvent` lifecycle; divergences documented for AG-UI promotion.

## Verification

- `pnpm test:renderer src/renderer/src/artifacts/__tests__/designProtocol.test.ts` — 27/27 pass (Node 24.16.0)
- Biome clean on both files; no `console.*`; tsgo (web) reports no errors from these files.

## Outcome

- Files: `src/renderer/src/artifacts/designProtocol.ts`,
  `src/renderer/src/artifacts/__tests__/designProtocol.test.ts`.
- Two-stage review: tdd-guide (build) → typescript-reviewer. Applied: HIGH `readonly`
  on `build_status` arrays; LOW named `ArtifactSourceLanguage` type; LOW pinned-hash
  test (`'' → 811c9dc5`, `'hello' → c3457ef7`); MEDIUM protocol-ordering + AG-UI
  divergence doc comments.
- QA gate (artifact-refiner): skipped — 2 files modified, below the <3-file threshold.
- Env note: repo requires Node >=24.11.1; default shell node is v20, use `nvm use 24`.
