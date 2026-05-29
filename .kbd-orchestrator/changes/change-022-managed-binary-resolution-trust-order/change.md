# change-022-managed-binary-resolution-trust-order

Status: DONE
Priority: P0
Assigned backend: claude-code
Depends on: `change-021-on-demand-runtime-install-policy`

## Goal

Make verified managed binaries the default execution source before PATH discovery while preserving explicit user and environment overrides.

## Tasks

- [x] Update UAR binary resolution order to configured path, `UAR_SIDECAR_PATH`, verified managed binary, opt-in PATH discovery, development fallback in dev only. (UAR has no dev fallback by design.)
- [x] Update Codex binary resolution order to configured path, `CODEX_CLI_PATH`, verified managed binary, opt-in PATH discovery, development fallback in dev only.
- [x] Update OpenCode binary resolution order to configured path, `OPENCODE_CLI_PATH`, verified managed binary, opt-in PATH discovery, development fallback in dev only.
- [x] Add or reuse a runtime setting that controls whether PATH discovery is allowed when no explicit path is configured. (Reused `sidecar.allowPathDiscovery`, default `false`, via shared `isPathDiscoveryAllowed` helper in `RuntimeBinaryDiscoveryService`. No DB schema change.)
- [x] Update Runtime Settings labels and docs so the displayed source matches the actual resolution order. (docs/en/guides/agent-runtimes.md updated; UI `binarySource` label map already order-agnostic and now reflects backend-corrected source.)
- [x] Add tests for managed-before-PATH precedence, disabled PATH discovery, enabled PATH discovery, explicit configured path, explicit environment path, and dev fallback gating.

## Outcome

- Resolution order is now `configured -> environment -> managed -> opt-in PATH -> dev` for all three runtimes.
- PATH discovery is gated on `sidecar.allowPathDiscovery === true` (default off).
- Verification: 3 runtime test files (28 tests) pass; full runtime + settings suite (18 files, 113 tests) pass; `typecheck:node`/`typecheck:web`/aiCore green; `git diff --check` clean.

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

