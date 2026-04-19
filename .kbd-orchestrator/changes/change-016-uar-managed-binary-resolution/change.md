# change-016-uar-managed-binary-resolution

Status: DONE
Priority: P1
Assigned backend: Codex
Depends on: `change-015-managed-binary-core`

## Goal

Move embedded UAR binary resolution to the managed binary service while preserving explicit overrides and bundled fallback.

## Tasks

- [x] Update `UniversalAgentRuntimeService` binary resolution order:
  - [x] runtime config `sidecar.binaryPath`
  - [x] `UAR_SIDECAR_PATH`
  - [x] verified app-data managed binary
  - [x] bundled fallback under `resources/binaries/<platform-arch>`
  - [x] missing/not-installed state.
- [x] Add UAR manifest fixture for current expected commit `c7c8416b94d39358ec7cf03691738426c25b2df8`.
- [x] Extend UAR sidecar status reporting for managed-binary states.
- [x] Keep current sidecar start/config behavior unchanged once a verified binary path is resolved.
- [x] Add tests for override precedence, managed resolution, bundled fallback, missing binary, and verification failure.

## Acceptance Criteria

- [x] UAR still runs through bundled fallback during transition.
- [x] Verified app-data UAR binary is preferred over bundled fallback.
- [x] Unverified or mismatched UAR binary is refused.
- [x] Runtime telemetry/status can identify the binary source.

## Verification

- UAR runtime service tests
- UAR embedded smoke test
- `pnpm run typecheck:node`
- `git diff --check`

## Results

- Runtime focused suite passed: 4 files, 13 tests.
- `pnpm run typecheck:node` passed.
- `pnpm format` passed with existing Biome schema-version info.
- `pnpm lint` passed with existing non-fatal warnings.
- `pnpm test` passed: 295 files, 4445 tests, 72 skipped.
- `git diff --check` passed.
- QA gate skipped because no artifact-refiner manifest/constraints exist for this native KBD change; focused UAR tests, embedded smoke coverage, runtime control tests, and typecheck cover the implementation.
