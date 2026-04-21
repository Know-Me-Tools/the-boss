# change-018-ipfs-transport-release-workflow

Status: DONE
Priority: P2
Assigned backend: Codex
Depends on: `change-017-managed-binary-ui-and-docs`

## Goal

Add optional IPFS transport and release workflow for managed binaries while retaining HTTPS fallback and manifest verification.

## Tasks

- [x] Add IPFS gateway transport behind the managed binary service.
- [x] Keep HTTPS fallback and retries.
- [x] Enforce SHA-256 and signature/manifest validation regardless of transport.
- [x] Add max-size enforcement.
- [x] Add release script support to emit per-platform hashes, manifest entries, and optional CID fields.
- [x] Document publishing UAR/RTK/future helper binaries.
- [x] Decide whether production packaging should remove bundled UAR after install/update reliability is proven.
- [x] Add tests for IPFS gateway fallback, CID/hash mismatch, max-size enforcement, and HTTPS fallback.

## Acceptance Criteria

- [x] IPFS is optional and never the only transport.
- [x] Hash/signature validation gates install.
- [x] Release docs provide an operator path to update UAR without app redistribution.
- [x] Production bundled-UAR removal has an explicit go/no-go decision based on smoke results.

## Verification

- managed binary transport tests
- release script tests
- docs review
- `git diff --check`

## Results

- Managed binary transport and release manifest tests passed: 2 files, 8 tests.
- `pnpm format` passed.
- `pnpm lint` passed with existing non-fatal warnings.
- `pnpm test` passed: 296 files, 4458 tests, 72 skipped.
- QA gate skipped because no artifact-refiner manifest/constraints exist for this native KBD change.
