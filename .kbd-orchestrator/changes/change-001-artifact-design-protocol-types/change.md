# change-001-artifact-design-protocol-types

Status: TODO
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

- [ ] Add `src/renderer/src/artifacts/designProtocol.ts` with the `ArtifactDesignEvent`
      discriminated union (`design_run_start`, `artifact_text_delta`, `artifact_full`,
      `build_status`, `artifact_saved`, `design_run_complete`, `design_run_error`).
- [ ] Add a Zod schema for the model's structured-output payload `{ source, language, notes? }`
      reusing `ArtifactSourceLanguageSchema` from `@shared/artifacts`.
- [ ] Add a `versionHash(source)` helper (stable content hash) used to anchor turns.
- [ ] Unit tests: valid/invalid payloads, hash stability, exhaustive union typing.

## Acceptance Criteria

- [ ] Union + schema + hash helper exported and unit-tested.
- [ ] No UI, no model calls, no main-process changes.
- [ ] Event kind names align 1:1 in spirit with `CanonicalAgentEvent` lifecycle.

## Verification

- `pnpm test:renderer src/renderer/src/artifacts/__tests__/designProtocol.test.ts`
- `pnpm lint`
