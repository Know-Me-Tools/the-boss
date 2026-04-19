# PLAN: binary distribution and package size reduction

Project: The Boss / Cherry Studio fork
Date: 2026-04-18T16:55:00Z
Phase: `multi-runtime-agent-parity-assessment`
Backend: native KBD
Assessment: `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/binary-distribution-assessment.md`

## Goal

Reduce packaged app size and make embedded runtime/helper binaries updateable without redistributing the whole Electron app.

The plan intentionally separates the immediate package-size defect from the larger managed-binary/IPFS design:

1. First remove build-only vendor material from packaged artifacts.
2. Then introduce a verified managed-binary installer.
3. Then migrate UAR embedded resolution onto that installer.
4. Then add product UI and smoke coverage.
5. Finally add IPFS as an optional content-addressed transport with HTTPS fallback.

## Constraints

- Stay on the current 1.9.x/main codebase. Do not use `v2`.
- Do not add Redux slices or IndexedDB schema changes.
- Keep logging through `loggerService`.
- Do not run downloaded binaries unless manifest and hash verification pass.
- Keep bundled UAR fallback until on-demand install/update is proven.
- Do not make IPFS the only transport; enterprise/offline reliability requires HTTPS fallback.

## Ordered Changes

### 1. `change-014-package-scope-size-fix`

Priority: P0
Recommended owner: Codex
Depends on: none

Fix the immediate 5 GB package regression by excluding build-only material from packaged artifacts.

Scope:

- Update `electron-builder.yml` packaging filters to exclude `vendor/**`, `.kbd-orchestrator/**`, `.refiner/**`, `dist/**`, and other build-only cache/output paths.
- Ensure `resources/binaries/<platform-arch>` remains platform-filtered for the target build.
- Add a package-content audit script or test that fails if `vendor/universal-agent-runtime`, Rust `target`, `.kbd-orchestrator`, `.refiner`, or `dist` appears in `app.asar`.
- Verify a mac arm64 build no longer includes `/vendor/universal-agent-runtime` in `app.asar`.

Acceptance:

- `pnpm build:mac:arm64` succeeds.
- `app.asar` no longer contains `/vendor`.
- Packaged app size drops by multiple GB from the prior 5.0 GB baseline.
- UAR bundled fallback still exists under unpacked resources for the current platform.

### 2. `change-015-managed-binary-core`

Priority: P1
Recommended owner: Codex
Depends on: `change-014-package-scope-size-fix`

Create a shared, security-first managed binary installer/resolver.

Scope:

- Add a main-process managed binary service for platform-keyed binaries.
- Define manifest types for name, version, source commit, platform, binary name, size, sha256, signature fields, HTTPS URL, optional IPFS CID, and supported platform policy.
- Resolve install paths under app data, for example `<userData>/Data/managed-binaries/<name>/<version>/<platform-arch>/`.
- Implement local status, hash verification, atomic install, chmod on Unix, rollback-safe temp paths, and clear error states.
- Add download transport abstraction with HTTPS/file transport first; IPFS remains future-facing in this change.
- Add targeted tests for platform selection, hash mismatch, unsupported platform, atomic install, and resolution precedence.

Acceptance:

- Managed binary service can verify and install a test binary from a local/file transport.
- Verification failure prevents execution/resolution.
- Tests cover success and failure paths.

### 3. `change-016-uar-managed-binary-resolution`

Priority: P1
Recommended owner: Codex
Depends on: `change-015-managed-binary-core`

Move embedded UAR binary resolution to the managed binary service while preserving explicit overrides and bundled fallback.

Scope:

- Change `UniversalAgentRuntimeService` resolution order:
  1. `runtimeConfig.sidecar.binaryPath`
  2. `UAR_SIDECAR_PATH`
  3. verified managed binary in app data
  4. bundled fallback under `resources/binaries/<platform-arch>`
  5. missing/not-installed state
- Extend sidecar status states for not installed, downloading, verifying, installed, update available, verification failed, download failed, and unsupported platform.
- Add a UAR manifest fixture using the current expected commit `c7c8416b94d39358ec7cf03691738426c25b2df8`.
- Keep current embedded start behavior unchanged once a verified binary path is resolved.
- Add tests for override precedence, managed path resolution, bundled fallback, missing binary, and verification failure.

Acceptance:

- UAR can still run from the bundled fallback during transition.
- A verified app-data UAR binary is preferred over bundled fallback.
- An unverified/mismatched UAR binary is refused.

### 4. `change-017-managed-binary-ui-and-docs`

Priority: P1
Recommended owner: Codex
Depends on: `change-016-uar-managed-binary-resolution`

Expose managed binary status/install/update behavior in the runtime settings product surface.

Scope:

- Add IPC/preload/API methods for managed binary status, install/update, and progress/status retrieval.
- Add runtime settings UI for UAR embedded install/update/status.
- Show explicit states: not installed, installed, update available, downloading, verifying, failed, unsupported, bundled fallback in use.
- Add i18n keys for all user-visible strings.
- Update `docs/en/guides/agent-runtimes.md` with managed binary setup, fallback, verification, and offline notes.
- Add renderer tests for install/update/status UI behavior.

Acceptance:

- User can see whether UAR is bundled, managed, missing, or failed verification.
- Install/update action calls backend IPC, not local-only UI state.
- Docs explain the new binary lifecycle.

### 5. `change-018-ipfs-transport-release-workflow`

Priority: P2
Recommended owner: Codex
Depends on: `change-017-managed-binary-ui-and-docs`

Add optional IPFS transport and release artifact workflow after the managed binary path is proven.

Scope:

- Add IPFS gateway transport behind the managed binary service.
- Keep HTTPS fallback and retry behavior.
- Add release script support to produce per-platform binary archives, hashes, manifest entries, and optional CID fields.
- Add manifest signing/verification hook points; do not accept unsigned remote manifests as trusted.
- Add docs for publishing UAR/RTK/future managed binaries.
- Add tests for gateway fallback, CID/hash mismatch, max-size enforcement, and HTTPS fallback.
- Decide whether production packaging should stop bundling UAR once install/update reliability is proven; keep dev/offline fallback documented.

Acceptance:

- IPFS transport is optional and never the sole source.
- Hash/signature validation still gates install.
- Release docs describe how to publish a new UAR version without app redistribution.

## Verification Plan

Per-change verification:

- `change-014`: package audit script/test, `pnpm build:mac:arm64`, app.asar inspection, size comparison.
- `change-015`: managed binary unit tests and node typecheck.
- `change-016`: UAR service tests, UAR embedded smoke test, node typecheck.
- `change-017`: IPC/API tests, renderer settings tests, i18n check, docs review.
- `change-018`: transport/release script tests, manifest validation tests, docs review.

Final verification:

- `pnpm format`
- `pnpm lint`
- `pnpm test`
- `pnpm build:mac:arm64`
- `git diff --check`

## Risks

- macOS execution of downloaded binaries may require additional code-signing/notarization handling.
- IPFS gateway reliability is variable; HTTPS fallback is mandatory.
- Removing bundled UAR too early would break offline embedded UAR.
- A weak manifest design would create a supply-chain vulnerability.

## Next Step

Execute `change-014-package-scope-size-fix` first. Do not start the managed-binary/IPFS work until the packaging scope defect is fixed and measured.

PLAN COMPLETE
