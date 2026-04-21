# change-014-package-scope-size-fix

Status: DONE
Priority: P0
Assigned backend: Codex
Depends on: none

## Goal

Fix the immediate packaged app size regression by preventing build-only vendor and orchestration artifacts from entering packaged Electron artifacts.

## Context

The binary distribution assessment found that the 5 GB mac arm64 app is primarily caused by `vendor/universal-agent-runtime` being packaged into `app.asar`. The vendored checkout is about 3.7 GB, mostly Rust `target` build output. The UAR executable itself is about 120 MB.

## Tasks

- [x] Update `electron-builder.yml` `files` filters to exclude build-only directories:
  - [x] `vendor/**`
  - [x] `.kbd-orchestrator/**`
  - [x] `.refiner/**`
  - [x] `dist/**`
  - [x] generated Rust `target/**` build output.
- [x] Preserve packaging of required runtime resources under `resources/**`.
- [x] Preserve target-platform filtering for `resources/binaries/<platform-arch>`.
- [x] Add a package-content audit script or test that fails if packaged `app.asar` contains:
  - [x] `/vendor`
  - [x] Rust `target`
  - [x] `.kbd-orchestrator`
  - [x] `.refiner`
  - [x] nested `dist` build output.
- [x] Run and record a mac arm64 build size comparison.

## Acceptance Criteria

- [x] `pnpm build:mac:arm64` succeeds.
- [x] `app.asar` no longer contains `/vendor/universal-agent-runtime`.
- [x] Packaged app size drops by multiple GB from the 5.0 GB baseline.
- [x] UAR bundled fallback remains available for the target platform under unpacked resources.
- [x] No product runtime behavior is changed.

## Results

- `dist/mac-arm64/The Boss.app`: 1.4G
- `dist/mac-arm64/The Boss.app/Contents/Resources/app.asar`: 225M
- `dist/mac-arm64/The Boss.app/Contents/Resources/app.asar.unpacked`: 522M
- `dist/The-Boss-1.9.1-arm64.dmg`: 474M
- `dist/The-Boss-1.9.1-arm64.zip`: 465M
- `dist/The-Boss-1.9.1-arm64.zip.blockmap`: 463K

Verification passed:

- `pnpm vitest run scripts/__tests__/verify-packaged-runtime-deps.test.ts`
- `pnpm build:mac:arm64`
- `node scripts/verify-packaged-runtime-deps.js dist/mac-arm64`
- `pnpm format`
- `pnpm lint`
- `pnpm test`
- `git diff --check`

## Verification

- `pnpm build:mac:arm64`
- package audit script/test
- `app.asar` inspection
- `git diff --check`
