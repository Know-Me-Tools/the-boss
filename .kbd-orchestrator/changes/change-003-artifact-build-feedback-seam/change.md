# change-003-artifact-build-feedback-seam

Status: TODO
Priority: P0
Assigned backend: claude-code (subagent-driven TDD)
Recommended agent: tdd-guide → typescript-reviewer
Depends on: change-001-artifact-design-protocol-types
Phase: artifact-editor-iterative-design-protocol

## Goal

Provide the build/validate pass that closes "edit again until functional" by emitting a
`build_status` event. Reuse the existing seam: `ArtifactService.compileReactArtifact`
already returns `{ code, diagnostics, errors }` — that is the payload. HTML artifacts get
a lighter validation pass.

## Tasks

- [ ] Add `src/renderer/src/artifacts/buildFeedback.ts`.
- [ ] React: call `window.api.artifacts.compileReactArtifact` and map
      `{ diagnostics, errors }` → `build_status{ ok, diagnostics, errors }`.
- [ ] HTML: light validation (parse + sandboxed-load signal) → `build_status`.
- [ ] Unit tests with mocked compile API: ok / diagnostics-only / hard errors; HTML
      happy + malformed.

## Acceptance Criteria

- [ ] React build mapping verified against `CompileReactArtifactResponse` shape.
- [ ] HTML validation produces a deterministic `build_status`.
- [ ] No UI; pure module with the IPC call injected/mockable.

## Verification

- `pnpm test:renderer src/renderer/src/artifacts/__tests__/buildFeedback.test.ts`
- `pnpm lint`
