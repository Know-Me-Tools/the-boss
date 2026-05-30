# change-004-artifact-design-orchestrator

Status: TODO
Priority: P1
Assigned backend: claude-code (subagent-driven TDD)
Recommended agent: tdd-guide → code-reviewer
Depends on: change-001, change-002, change-003
Phase: artifact-editor-iterative-design-protocol

## Goal

The renderer-orchestrated loop. Take an NL request + current artifact source, call the
chat model via structured output / tool (reuse existing model plumbing in
`src/renderer/src/aiCore` / `packages/aiCore`), and translate the response into
`ArtifactDesignEvent`s that drive the reducer. Full-file rewrite per turn:
prompt → `artifact_full` → reducer applies → 003 builds → `build_status`.

## Tasks

- [ ] Add `src/renderer/src/artifacts/designOrchestrator.ts`.
- [ ] Choose structured-output mechanism (tool call vs response schema) from existing
      aiCore plumbing; keep provider-agnostic. Validate output with change-001 schema.
- [ ] Emit `design_run_start` (with current head hash as `baseVersionHash`) →
      `artifact_full` → invoke build seam → `build_status` → `design_run_complete`.
- [ ] On model/validation failure emit `design_run_error`.
- [ ] Unit/integration test with a mocked model: successful turn; failing-build turn
      that triggers a repair turn.

## Acceptance Criteria

- [ ] One turn round-trips through reducer + build seam deterministically.
- [ ] Stale base hash is impossible (orchestrator always anchors to current head).
- [ ] No UI yet; orchestrator is testable with a mocked model + mocked build.

## Verification

- `pnpm test:renderer src/renderer/src/artifacts/__tests__/designOrchestrator.test.ts`
- `pnpm lint`
