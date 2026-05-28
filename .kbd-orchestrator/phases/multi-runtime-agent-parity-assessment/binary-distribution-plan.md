# PLAN: resilient managed sidecar distribution

Project: The Boss / Cherry Studio fork
Date: 2026-05-26T10:48:06Z
Phase: `multi-runtime-agent-parity-assessment`
Backend: native KBD
Assessment: `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/binary-distribution-assessment.md`
OpenSpec available: NO
Evolver bridge: NO
Changes to implement: 6

## Goal

Make sidecar distribution smaller, updateable, and resilient by moving from bootstrap IPFS CIDs to a signed runtime channel manifest, on-demand installs, verified managed binary precedence, and supervised sidecar processes.

This plan extends the completed `change-014` through `change-018` managed-binary foundation. It does not reintroduce bundled production sidecars, does not use `v2`, and does not weaken the existing hash verification path.

## Constraints

- Stay on the current 1.9.x/main codebase. Do not use `v2`.
- Do not add Redux slices or IndexedDB schema changes without explicit approval.
- Route logging through `loggerService`.
- Do not execute downloaded binaries unless manifest signature, platform, size, and hash verification pass.
- IPFS must not be the only transport; keep HTTPS fallback.
- The app must launch and remain useful if IPFS, IPNS, DNSLink, or HTTPS manifest fetches fail.
- Do not run large sidecar downloads at startup unless the user explicitly enables that policy.

## Ordered Changes

### 1. `change-019-signed-runtime-channel-manifest`

Priority: P0
Recommended owner: Codex
Depends on: `change-018-ipfs-transport-release-workflow`

Add a signed runtime manifest trust root and reject unsigned or rollback-prone remote runtime manifests.

Scope:

- Add a manifest v2 schema for channel metadata, sequence, expiry, app-version bounds, artifact metadata, revocations, and signatures.
- Add signature verification for remote/channel manifests using a public key shipped with the app.
- Persist the highest accepted manifest sequence and last verified manifest in app data.
- Reject unsigned production manifests, expired manifests, rollback sequences, wrong runtime names, wrong platforms, wrong binary names, and revoked artifacts.
- Keep SHA-256 verification in `ManagedBinaryService` as the artifact-level gate after manifest trust is established.
- Add tests for signature success/failure, sequence rollback, expiry, platform filtering, and fallback to the last verified manifest.

Acceptance:

- A remote manifest is not accepted unless its signature verifies against the trusted key.
- A lower sequence than the last accepted sequence is rejected unless an explicit development/test override is active.
- If manifest refresh fails, the last verified manifest or shipped bootstrap manifest can still be used safely.

### 2. `change-020-ipns-dnslink-runtime-manifest-publish`

Priority: P0
Recommended owner: Codex
Depends on: `change-019-signed-runtime-channel-manifest`

Publish the signed release manifest itself to IPFS and expose it through a stable mutable name.

Scope:

- Update runtime artifact publishing so it writes a signed release manifest, uploads it to IPFS, and records the manifest CID.
- Add optional IPNS publish support using a dedicated runtime-channel key.
- Add DNSLink documentation for mapping `_dnslink.runtimes.prometheusags.ai` to the runtime IPNS name.
- Add app-side manifest resolution from DNSLink/IPNS gateway URLs with HTTPS manifest fallback.
- Keep immutable artifact CIDs inside the signed manifest.
- Add release docs for rotating the IPNS key, pinning manifests/artifacts, and verifying published CIDs.

Acceptance:

- Release operators can publish a new runtime manifest without rebuilding the desktop app.
- The app can resolve the latest signed runtime manifest via a stable IPNS/DNSLink name.
- If IPNS/DNSLink resolution fails, HTTPS fallback or the last verified manifest keeps runtime status usable.

### 3. `change-021-on-demand-runtime-install-policy`

Priority: P0
Recommended owner: Codex
Depends on: `change-019-signed-runtime-channel-manifest`

Stop eager startup sidecar downloads and make installs explicit, lazy, cancelable, and failure-tolerant.

Scope:

- Remove or gate `managedRuntimeService.reconcile()` from app startup.
- Replace startup install attempts with lightweight status/manifest checks.
- Trigger installs only from explicit Runtime Settings actions or when starting a session that requires an absent runtime.
- Serialize install operations per runtime and surface progress/cancellation over existing IPC.
- Preserve a previously verified runtime if an update download or verification fails.
- Add tests for offline startup, no-startup-download behavior, concurrent install dedupe, cancellation, and previous-version retention.

Acceptance:

- A clean app launch performs no large managed-runtime binary downloads by default.
- Missing or unreachable IPFS does not block app startup.
- Failed runtime update leaves the prior verified binary available.

### 4. `change-022-managed-binary-resolution-trust-order`

Priority: P0
Recommended owner: Codex
Depends on: `change-021-on-demand-runtime-install-policy`

Make verified managed binaries the default execution source before PATH discovery.

Scope:

- Change UAR, Codex, and OpenCode resolution order to: explicit configured path, explicit environment override, verified managed binary, user-enabled system PATH discovery, development checkout in dev only.
- Add a runtime setting or existing config flag for allowing system PATH binaries when no explicit path is configured.
- Update Runtime Settings source labels and docs to match the implemented order.
- Add tests for configured path precedence, env override precedence, managed-before-PATH precedence, disabled PATH discovery, and dev fallback gating.

Acceptance:

- A random/stale binary on PATH cannot silently override a verified app-managed binary.
- Users can still opt into a system binary deliberately.
- Runtime telemetry clearly reports the selected binary source.

### 5. `change-023-sidecar-process-supervisor`

Priority: P0
Recommended owner: Codex
Depends on: `change-022-managed-binary-resolution-trust-order`

Add shared lifecycle supervision for sidecars so CPU, memory, start failures, and orphaned child processes are visible and controllable.

Scope:

- Add a main-process `SidecarProcessSupervisor` for UAR, OpenCode, Codex app-server probes, and future sidecars.
- Track pid, runtime name, binary path/version, cwd, start time, health state, restart count, last stderr lines, CPU sample, and memory RSS.
- Add idle shutdown, max restart budget, start-failure backoff, stop/kill escalation, and process-group cleanup where supported.
- Route UAR and OpenCode sidecar spawning through the supervisor first.
- Expose supervisor status through runtime health/status IPC and Runtime Settings.
- Add tests for idle shutdown, restart budget, kill escalation, stale process cleanup, and status reporting.

Acceptance:

- Runtime Settings can show which sidecars are running and their resource state.
- A runaway sidecar can be stopped or killed from the app.
- Sidecars do not remain orphaned after app quit or managed runtime failure paths.

### 6. `change-024-runtime-release-matrix`

Priority: P1
Recommended owner: Codex
Depends on: `change-020-ipns-dnslink-runtime-manifest-publish`, `change-023-sidecar-process-supervisor`

Turn the runtime artifact workflow into a platform matrix with archives, signatures, notarization metadata, and release gates.

Scope:

- Build supported runtime artifacts for `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`, and `win32-arm64` where upstream runtimes support them.
- Package artifacts as `tar.zst` or `zip` archives with executable, metadata, license/notice, detached signature, and optional SBOM.
- Sign and notarize macOS runtime artifacts in CI and record Team ID/signing metadata in the signed manifest.
- Merge per-platform artifact metadata into one signed release manifest.
- Fail the release if required platform artifacts, signatures, hashes, or notarization metadata are missing.
- Add documentation for local dry runs and production release.

Acceptance:

- A single signed runtime channel manifest contains all supported platform artifacts.
- macOS managed sidecars have an explicit signing/notarization story.
- Release CI fails before publishing incomplete or unverifiable platform artifacts.

## Execution Round Order

Round 1: `change-019-signed-runtime-channel-manifest`
Round 2: `change-020-ipns-dnslink-runtime-manifest-publish` and `change-021-on-demand-runtime-install-policy`
Round 3: `change-022-managed-binary-resolution-trust-order`
Round 4: `change-023-sidecar-process-supervisor`
Round 5: `change-024-runtime-release-matrix`

## Verification Plan

Per-change verification:

- `change-019`: manifest verification unit tests, node typecheck, fallback manifest tests.
- `change-020`: publisher tests, IPNS/DNSLink resolver tests with mocks, docs review.
- `change-021`: runtime control tests, offline startup test, install cancellation/dedupe tests.
- `change-022`: UAR/Codex/OpenCode binary resolution tests, renderer label tests, docs review.
- `change-023`: supervisor unit tests, UAR/OpenCode integration tests, renderer status tests.
- `change-024`: release script tests, matrix manifest merge tests, packaged app audit, macOS signing/notarization dry-run where credentials are available.

Final verification:

```bash
pnpm format
pnpm lint
pnpm test
pnpm build:mac:arm64
git diff --check
```

## Risks

- Manifest signing must be simple enough for release operators to run consistently.
- IPNS propagation and gateway caching can be slower than direct CID access, so the app needs timeout and fallback policy.
- Process CPU/memory sampling differs by OS and may require per-platform implementation.
- macOS notarization cannot be fully tested without signing credentials in the release environment.
- Cross-platform runtime builds may expose upstream support gaps that need explicit unsupported-platform manifest entries.

## Next Step

Execute `change-019-signed-runtime-channel-manifest` first. Do not use `v2`.

PLAN COMPLETE
