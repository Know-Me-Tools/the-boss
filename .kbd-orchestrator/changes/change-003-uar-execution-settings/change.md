# change-003-uar-execution-settings

Status: done
Phase: `multi-runtime-agent-parity-assessment`
Depends on: `change-001-runtime-agent-model`
Recommended agent: Codex
Complexity: L

## Goal

Make UAR runnable and configurable in embedded sidecar and remote endpoint modes.

## Scope

- `UniversalAgentRuntimeService`.
- `UarRuntimeAdapter`.
- UAR global settings persistence.
- Sidecar build/packaging scripts and resource wiring.
- Health/readiness tests.

## Tasks

- [x] Add UAR global settings persistence foundation through runtime settings/profile records used by UI and runtime execution.
- [x] Support fixed and auto HTTP port selection.
- [x] Support optional gRPC port configuration where applicable.
- [x] Support embedded sidecar settings for binary path, data paths, generated config, log level, and native tool policy.
- [x] Support remote UAR base URL and auth reference resolution.
- [x] Add health/readiness checks for embedded and remote modes.
- [x] Fix the stale UAR `Cargo.lock` locked-build blocker by refreshing the vendored lockfile and adding an intentional build-script retry.
- [x] Ensure generated config is deterministic and does not leak provider secrets into config or logs.
- [x] Add tests for sidecar config generation and endpoint resolution.

## Verification

- [x] Embedded UAR can start with configured or auto ports.
- [x] Remote UAR can be health-checked and used without starting a sidecar.
- [x] `pnpm uar:build:sidecar` succeeds.
- [x] Logs use `loggerService`.

## Verification Results

- PASS: `pnpm vitest run src/main/services/agents/services/runtime/__tests__/UniversalAgentRuntimeService.test.ts src/main/services/agents/services/runtime/__tests__/UarRuntimeAdapter.test.ts`
- PASS: `pnpm run typecheck:node`
- PASS: `pnpm uar:build:sidecar`

## Constraints

- Do not expose Node APIs to renderer directly.
- Do not treat embedded UAR as shippable until binary packaging succeeds.
