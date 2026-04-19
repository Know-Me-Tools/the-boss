# change-015-managed-binary-core

Status: DONE
Priority: P1
Assigned backend: Codex
Depends on: `change-014-package-scope-size-fix`

## Goal

Create a shared managed binary service that can securely resolve, verify, install, and report status for platform-specific helper/runtime binaries.

## Tasks

- [x] Define manifest types for managed binaries:
  - [x] name
  - [x] version
  - [x] source commit
  - [x] platform key
  - [x] binary name
  - [x] size
  - [x] SHA-256
  - [x] signature fields
  - [x] HTTPS URL
  - [x] optional IPFS CID
  - [x] supported platform policy.
- [x] Add app-data install path resolution under `Data/managed-binaries`.
- [x] Implement status states for missing, installed, verifying, verification failed, downloading, download failed, unsupported platform, and update available.
- [x] Implement hash verification before install or execution.
- [x] Implement atomic install through temp paths and rename.
- [x] Implement chmod handling for Unix binaries.
- [x] Add HTTPS/file transport abstraction; IPFS is not required in this change.
- [x] Add targeted tests for success and failure paths.

## Acceptance Criteria

- [x] A test binary can be installed from a local/file transport.
- [x] Hash mismatch prevents installation/resolution.
- [x] Unsupported platform is reported without download.
- [x] App-data paths are deterministic and do not depend on packaged resources.
- [x] No downloaded binary is executable until verification succeeds.

## Verification

- managed binary service tests
- `pnpm run typecheck:node`
- `git diff --check`

## Results

- `pnpm vitest run src/main/services/agents/services/runtime/__tests__/ManagedBinaryService.test.ts` passed.
- Runtime focused suite passed: 4 files, 13 tests.
- `pnpm run typecheck:node` passed.
- QA gate skipped because no artifact-refiner manifest/constraints exist for this native KBD change; targeted tests and typecheck cover the implementation.
