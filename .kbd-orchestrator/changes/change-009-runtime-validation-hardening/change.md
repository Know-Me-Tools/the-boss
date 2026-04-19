# change-009-runtime-validation-hardening

Status: done
Phase: `multi-runtime-agent-parity-assessment`
Depends on: `change-002-runtime-settings-ui`, `change-003-uar-execution-settings`, `change-006-codex-runtime-parity`, `change-007-opencode-runtime-parity`, `change-008-runtime-chat-telemetry`
Recommended agent: Codex
Complexity: L

## Goal

Verify the multi-runtime implementation end-to-end and document how to configure and run each runtime.

## Scope

- Unit and integration tests.
- Runtime mocks/fixtures.
- UAR packaging verification.
- Documentation/update notes.
- Required project gates.

## Tasks

- [x] Add test coverage for runtime profiles and compatibility resolution.
- [x] Add test coverage for runtime settings UI save/load behavior.
- [x] Add test coverage for prompt bundle generation with skills and knowledge.
- [x] Add adapter tests for Claude, Codex, OpenCode, and UAR config mapping.
- [x] Add renderer tests for runtime telemetry blocks.
- [x] Add a manual or automated smoke checklist for running Codex, OpenCode, and UAR.
- [x] Document runtime setup, required binaries, remote endpoint configuration, and known limitations.
- [x] Run `pnpm format`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm test`.
- [x] Run targeted UAR sidecar packaging verification.

## Verification

- [x] Required project verification commands pass, or blockers are documented with logs and owner scope.
- [x] Documentation explains how to configure and run all new runtime types.
- [x] No runtime claims full lossless compatibility when the capability resolver reports degradation.

## Verification Log

- `pnpm format` — passed.
- `pnpm lint` — passed with non-fatal warnings:
  - oxlint still reports one warning from `resources/skills/prometheus-skill-system/scripts/build-marketplace.js` despite the lint script ignore pattern.
  - React hooks exhaustive-deps warnings remain in `src/renderer/src/hooks/useSkills.ts` and `src/renderer/src/pages/settings/AgentSettings/components/RuntimeSettings.tsx`.
- `pnpm vitest run src/main/services/agents/services/runtime/__tests__/runtimeModel.test.ts src/main/services/agents/services/runtime/__tests__/RuntimeSkillBridgeService.test.ts src/main/services/agents/services/runtime/__tests__/UniversalAgentRuntimeService.test.ts src/renderer/src/pages/settings/AgentSettings/components/__tests__/RuntimeSettings.test.tsx src/renderer/src/aiCore/chunk/__tests__/AiSdkToChunkAdapter.contextManagement.test.ts src/renderer/src/services/__tests__/StreamProcessingService.test.ts src/renderer/src/services/messageStreaming/callbacks/__tests__/runtimeCallbacks.test.ts src/renderer/src/pages/home/Messages/Blocks/__tests__/RuntimeBlock.test.tsx` — passed, 8 files / 34 tests.
- `pnpm uar:build:sidecar` — passed and copied the darwin-arm64 sidecar plus `.uar-version` metadata.
- `pnpm test` — passed, 290 files / 4,428 tests passed / 72 skipped.
- `pnpm lint` — rerun after test hardening and passed with non-fatal warnings only.

## Resolved Blocker

The repo-wide `pnpm test` baseline initially failed under Vitest 4 because several constructor-style mocks used arrow functions. The affected mocks were updated to use normal function constructors, stale expectations were aligned with the current service contracts, and the full test gate now passes.

## Constraints

- Features without tests are not complete.
- Do not claim completion if known repo-wide blockers still prevent required gates from passing.
