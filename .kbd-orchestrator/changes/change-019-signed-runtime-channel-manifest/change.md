# change-019-signed-runtime-channel-manifest

Status: TODO
Priority: P0
Assigned backend: Codex
Depends on: `change-018-ipfs-transport-release-workflow`

## Goal

Add a signed runtime channel manifest trust root so remote runtime metadata cannot silently redirect users to untrusted sidecar binaries.

## Tasks

- [x] Define manifest v2 schema with channel, sequence, publish/expiry timestamps, app-version bounds, artifact metadata, revocations, and signature fields.
- [x] Add trusted public-key configuration shipped with the app.
- [x] Verify remote/channel manifest signatures before accepting any runtime artifact metadata.
- [x] Persist highest accepted manifest sequence and reject rollback attempts in production.
- [x] Persist the last verified manifest and use it when remote refresh fails.
- [x] Keep artifact SHA-256, size, max-size, platform, and binary-name verification in the install path.
- [x] Add tests for valid signature, invalid signature, missing signature, expired manifest, rollback sequence, unsupported platform, and last-verified fallback.

## Acceptance Criteria

- [x] Unsigned production runtime manifests are rejected.
- [x] Remote manifests signed by an unknown key are rejected.
- [x] Lower manifest sequence numbers are rejected after a newer sequence has been accepted.
- [x] If manifest refresh fails, the app can still use a previously verified manifest or shipped bootstrap data.
- [x] Existing managed binary hash verification remains in force after manifest verification.

## Verification

- `pnpm vitest run src/main/services/agents/services/runtime/__tests__/ManagedRuntimeService.test.ts src/main/services/agents/services/runtime/__tests__/ManagedBinaryService.test.ts`
- `pnpm run typecheck:node`
- `git diff --check`

## Results

- Focused manifest/binary tests passed: 2 files, 14 tests.
- Affected runtime import regression tests passed: 4 files, 22 tests.
- `pnpm format` passed with existing Biome schema-version info.
- `pnpm lint` passed with existing warnings.
- `pnpm test` passed: 324 files, 4780 tests, 72 skipped.
- `git diff --check` passed.
- QA gate skipped because no artifact-refiner manifest or constraints file exists for this native KBD change.
