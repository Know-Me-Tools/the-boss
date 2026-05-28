# change-021-on-demand-runtime-install-policy

Status: DONE
Priority: P0
Assigned backend: Codex
Depends on: `change-019-signed-runtime-channel-manifest`

## Goal

Stop eager startup managed-runtime downloads and make runtime installs explicit, lazy, cancelable, and safe when offline.

## Tasks

- [x] Remove or gate `managedRuntimeService.reconcile()` from app startup.
- [x] Replace startup install attempts with lightweight runtime status/manifest checks.
- [x] Trigger installs only from Runtime Settings actions or session start for a selected missing runtime.
- [x] Serialize install/update operations per runtime to prevent duplicate downloads.
- [x] Add cancellation support for active managed runtime installs.
- [x] Preserve previous verified binaries if an update download or verification fails.
- [x] Surface offline, gateway unavailable, download failed, verification failed, and previous-version-retained states.
- [x] Add tests for offline app startup, no default startup download, concurrent install dedupe, cancellation, and previous-version retention.

## Acceptance Criteria

- [x] A clean app launch performs no large managed-runtime binary downloads by default.
- [x] Missing IPFS/IPNS/HTTPS connectivity does not block app startup.
- [x] Users can install/update explicitly from settings.
- [x] Failed updates do not delete the last verified runtime binary.

## Verification

- `pnpm vitest run src/main/services/agents/services/runtime/__tests__/RuntimeControlService.test.ts src/main/services/agents/services/runtime/__tests__/ManagedBinaryService.test.ts`
- `pnpm run typecheck:node`
- `git diff --check`

## Results

- Removed the startup managed runtime reconciliation call so clean app launch no longer attempts large sidecar downloads.
- Runtime session startup now lazily installs a selected missing managed runtime, while explicit Runtime Settings install remains available.
- Managed runtime installs are deduplicated per runtime and existing cancellation signals continue to abort active downloads.
- Failed updates now report `previous-version-retained` when an older app-managed binary remains available.
- Runtime Settings and docs now surface the retained-previous-version state and the on-demand install policy.
- Verification passed: focused runtime tests, node typecheck, `pnpm format`, `pnpm lint`, full `pnpm test`, and `git diff --check`.
- Artifact-refiner QA skipped because this repository has no artifact-refiner input manifest or constraints file for the native KBD change.
