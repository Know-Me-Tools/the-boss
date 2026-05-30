# change-006-designer-build-loop-wiring

Status: TODO
Priority: P1
Assigned backend: claude-code (subagent-driven TDD)
Recommended agent: tdd-guide → code-reviewer
Depends on: change-003, change-004, change-005
Phase: artifact-editor-iterative-design-protocol

## Goal

Close the build-in-the-loop end to end and persist results. A failed `build_status`
surfaces in the chat pane and seeds the next turn ("edit again until functional"); on
accept, save a new `ArtifactVersion` via `useArtifactLibrary`.

## Tasks

- [ ] Surface `build_status` diagnostics/errors in the chat pane; offer "fix it" that
      feeds the failure into the next orchestrator turn.
- [ ] On accept → `useArtifactLibrary` save creating a new `ArtifactVersion`
      (`emit artifact_saved`).
- [ ] Cancel/rollback leaves the library untouched.
- [ ] Visible loading / error / repair states.
- [ ] Integration test: create → failing edit → repaired edit → preview → save (new
      version); cancel path leaves library unchanged.

## Acceptance Criteria

- [ ] Build failures drive a repair turn without manual re-prompting friction.
- [ ] Accepting saves a new version; canceling does not mutate the library.
- [ ] Loop is observable (states visible in UI).

## Verification

- `pnpm test:renderer` (designer loop integration test)
- `pnpm lint`
