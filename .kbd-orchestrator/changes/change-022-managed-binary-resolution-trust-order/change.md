# change-022-managed-binary-resolution-trust-order

Status: TODO
Priority: P0
Assigned backend: Codex
Depends on: `change-021-on-demand-runtime-install-policy`

## Goal

Make verified managed binaries the default execution source before PATH discovery while preserving explicit user and environment overrides.

## Tasks

- [ ] Update UAR binary resolution order to configured path, `UAR_SIDECAR_PATH`, verified managed binary, opt-in PATH discovery, development fallback in dev only.
- [ ] Update Codex binary resolution order to configured path, `CODEX_CLI_PATH`, verified managed binary, opt-in PATH discovery, development fallback in dev only.
- [ ] Update OpenCode binary resolution order to configured path, `OPENCODE_CLI_PATH`, verified managed binary, opt-in PATH discovery, development fallback in dev only.
- [ ] Add or reuse a runtime setting that controls whether PATH discovery is allowed when no explicit path is configured.
- [ ] Update Runtime Settings labels and docs so the displayed source matches the actual resolution order.
- [ ] Add tests for managed-before-PATH precedence, disabled PATH discovery, enabled PATH discovery, explicit configured path, explicit environment path, and dev fallback gating.

## Acceptance Criteria

- [ ] A stale binary on PATH cannot silently override a verified app-managed binary.
- [ ] Users can deliberately opt into a system binary.
- [ ] Runtime status and telemetry identify the selected binary source.
- [ ] Docs and tests match the implemented resolution order.

## Verification

- `pnpm vitest run src/main/services/agents/services/runtime/__tests__/UniversalAgentRuntimeService.test.ts src/main/services/agents/services/runtime/__tests__/CodexCliService.test.ts src/main/services/agents/services/runtime/__tests__/OpenCodeCliService.test.ts`
- `pnpm run typecheck:node`
- `pnpm run typecheck:web`
- `git diff --check`

