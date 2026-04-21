# change-017-managed-binary-ui-and-docs

Status: DONE
Priority: P1
Assigned backend: Codex
Depends on: `change-016-uar-managed-binary-resolution`

## Goal

Expose managed binary status, install, and update behavior in the runtime settings UI and documentation.

## Tasks

- [x] Add IPC/preload/API methods for managed binary status.
- [x] Add IPC/preload/API method for install/update action.
- [x] Add progress or final-state reporting suitable for renderer display.
- [x] Extend Runtime Settings UAR embedded UI with install/update/status states.
- [x] Add i18n-backed labels/fallbacks for all new user-visible strings.
- [x] Update `docs/en/guides/agent-runtimes.md`.
- [x] Add renderer tests for missing, installed, downloading/verifying, failed, update available, and bundled fallback states.

## Acceptance Criteria

- [x] User can see whether UAR is missing, bundled, managed, failed verification, unsupported, or updateable.
- [x] Install/update action calls backend IPC.
- [x] Runtime settings do not claim UAR is ready when binary verification failed.
- [x] Docs explain offline fallback and update behavior.

## Verification

- renderer Runtime Settings tests
- managed binary IPC/preload tests
- `pnpm i18n:check`
- `pnpm run typecheck:web`
- `git diff --check`

## Results

- Runtime Settings renderer test passed: 10 tests.
- Runtime control/managed binary focused tests passed.
- `pnpm run typecheck:web` passed.
- `pnpm run typecheck:node` passed.
- `pnpm i18n:check` passed.
- QA gate skipped because no artifact-refiner manifest/constraints exist for this native KBD change.
