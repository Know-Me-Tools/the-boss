# ASSESSMENT: resilient managed sidecar distribution

Project: The Boss / Cherry Studio fork
Phase: `multi-runtime-agent-parity-assessment`
Date: 2026-05-26T10:41:45Z
Question: How should The Boss stop packaging sidecars in the DMG, distribute platform binaries through IPFS/IPNS, and remain reliable when sidecar downloads or sidecar processes fail?

## Executive Assessment

The application is already partway through the desired architecture. Production packaging now excludes `vendor/**`, `.kbd-orchestrator/**`, `.refiner/**`, `dist/**`, and UAR binaries from the packaged resources, and the codebase has a managed-binary service that can install `universal-agent-runtime`, `opencode`, and `codex` from IPFS CIDs recorded in `resources/runtime-manifests/bootstrap.json`.

The remaining risk is not the basic idea. The risk is that the current implementation is still a bootstrap-CID model, not a complete resilient distribution system:

- There is no IPNS/DNSLink manifest pointer yet.
- The runtime manifest is not signed or independently verified.
- The publisher uploads binaries to IPFS but does not upload/publish the manifest itself to IPFS/IPNS.
- Managed runtime reconciliation starts automatically at app startup and attempts installs for all runtimes.
- PATH-discovered binaries currently take precedence over verified managed binaries for UAR, Codex, and OpenCode.
- Sidecar process lifecycle controls are minimal and do not enforce CPU or memory limits.
- Only `darwin-arm64` is present in the current bootstrap manifest.

Verdict: continue with managed sidecars, but move from "bootstrap IPFS CIDs in app resources" to "signed channel manifest addressed by DNSLink/IPNS, containing immutable per-artifact CIDs and HTTPS fallbacks." Do not run automatic startup reconciliation for every runtime. Install on demand, cache locally, verify before execution, and treat sidecar process supervision as a separate P0 reliability track.

## Current Implementation Evidence

Packaging scope is mostly aligned with the goal:

- `electron-builder.yml` excludes `vendor/**`, `.kbd-orchestrator/**`, `.refiner/**`, `dist/**`, and `target/**`.
- `electron-builder.yml` includes `resources/**/*` but explicitly excludes `resources/binaries/**/universal-agent-runtime` and `resources/binaries/**/universal-agent-runtime.exe`.
- `resources/opencode/**` is excluded from production packaging.

Managed binary support exists:

- `ManagedBinaryService` supports file, IPFS gateway, and HTTPS transports.
- It installs into app data under `Data/managed-binaries/<name>/<version>/<platform>/<binary>`.
- It validates platform, exact size, max size, and SHA-256 before chmod/rename.
- It reports `missing`, `installed`, `verification-failed`, `download-failed`, `unsupported-platform`, and `update-available`.
- IPFS download uses gateways in this order: `THE_BOSS_IPFS_GATEWAY_URL` or `https://ipfs.prometheusags.ai/ipfs/`, then `https://ipfs.io/ipfs/`, then `https://cloudflare-ipfs.com/ipfs/`.

Release support exists but is incomplete:

- `scripts/build-runtime-artifacts.js` builds only the current host platform and emits per-runtime manifests with `size`, `sha256`, and `filePath`.
- `scripts/publish-runtime-artifacts-ipfs.js` uploads each binary using Kubo-compatible `/api/v0/add?pin=true&cid-version=1`, writes returned CIDs into `resources/runtime-manifests/bootstrap.json`, and deletes local `filePath`.
- The publisher does not upload the combined manifest to IPFS, publish IPNS, update DNSLink, or emit a signed manifest.

Runtime resolution currently has a trust-order problem:

- UAR resolution order is configured path, `UAR_SIDECAR_PATH`, PATH discovery, then verified managed binary.
- Codex and OpenCode also resolve PATH-discovered binaries before managed binaries.
- Docs say the intended order is configured path, environment path, verified managed binary, then development checkout, but implementation currently has PATH before managed.

Startup behavior is a reliability concern:

- `src/main/index.ts` calls `managedRuntimeService.reconcile()` during app startup.
- `ManagedRuntimeService.reconcile()` attempts to install UAR, OpenCode, and Codex in the background.
- Failures are logged and non-fatal, which protects app launch, but this still creates network and disk work at startup for runtimes the user may not need.

## Web Research Summary

IPFS CIDs are a good fit for immutable binary artifacts, but IPFS does not guarantee availability by itself. IPFS documentation distinguishes persistence from content addressing: content must be pinned or otherwise stored by reliable nodes, and pinning services or owned IPFS infrastructure are needed for availability. Source: [IPFS Persistence](https://docs.ipfs.tech/concepts/persistence/).

IPNS is appropriate for a mutable "latest manifest" pointer. IPFS docs describe IPNS names as signed, self-certifying pointers to `/ipfs/` or `/ipns/` paths that can be republished by the holder of the private key. Source: [IPNS](https://docs.ipfs.tech/concepts/ipns).

DNSLink is often more operationally friendly than exposing a raw IPNS key to the desktop app. It maps a DNS TXT record to an `/ipfs/` or `/ipns/` path, allowing a stable domain-backed name such as `/ipns/runtimes.prometheusags.ai`. Source: [DNSLink](https://docs.ipfs.tech/concepts/dnslink/).

Gateways can serve immutable IPFS CIDs and mutable IPNS/DNSLink resources. Gateway docs also note the common URL forms for `/ipfs/<CID>` and `/ipns/<name>`. Source: [IPFS Gateway](https://docs.ipfs.tech/concepts/ipfs-gateway/).

For macOS distribution, downloaded executables still need a signing/notarization strategy. Apple states that software distributed outside the Mac App Store must be signed with Developer ID and notarized for default Gatekeeper behavior on modern macOS. Source: [Apple notarization](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution).

## Recommended Architecture

Use a two-level manifest model:

1. Channel pointer: stable DNSLink/IPNS name.
2. Immutable release manifest: content-addressed JSON at `/ipfs/<manifestCid>`.
3. Immutable binary artifacts: content-addressed archives or executables at `/ipfs/<artifactCid>`.

Recommended stable pointer:

```text
_dnslink.runtimes.prometheusags.ai TXT "dnslink=/ipns/<runtime-channel-key>"
```

Recommended app bootstrap:

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "manifestName": "/ipns/runtimes.prometheusags.ai",
  "fallbackManifestCid": "bafy...",
  "trustedManifestPublicKeys": ["..."],
  "minimumManifestSequence": 42,
  "gatewayUrls": [
    "https://ipfs.prometheusags.ai/ipfs/",
    "https://ipfs.io/ipfs/"
  ],
  "manifestHttpsFallback": "https://api.prometheusags.ai/runtimes/manifest/stable.json"
}
```

Recommended release manifest:

```json
{
  "schemaVersion": 2,
  "channel": "stable",
  "sequence": 43,
  "publishedAt": "2026-05-26T00:00:00Z",
  "expiresAt": "2026-08-26T00:00:00Z",
  "artifacts": {
    "universal-agent-runtime": {
      "version": "0ab6b18c7626fb56da781f13f19c194cfb84b1c1",
      "sourceCommit": "0ab6b18c7626fb56da781f13f19c194cfb84b1c1",
      "platforms": {
        "darwin-arm64": {
          "binaryName": "universal-agent-runtime",
          "archiveName": "universal-agent-runtime-darwin-arm64.tar.zst",
          "archiveCid": "bafy...",
          "archiveSha256": "...",
          "binarySha256": "...",
          "size": 130476208,
          "maxSize": 170000000,
          "httpsUrl": "https://releases.prometheusags.ai/runtimes/universal-agent-runtime/darwin-arm64.tar.zst",
          "signatures": {
            "minisign": "...",
            "cosignBundle": "..."
          }
        }
      }
    }
  },
  "signature": {
    "algorithm": "minisign-ed25519",
    "keyId": "...",
    "value": "..."
  }
}
```

The app should trust the shipped public key and signed manifest, not the gateway, not a remote control-plane response, and not CID alone.

## Gap Report

### P0: Sign and verify manifests

Current state:

- Manifest entries have optional `signatures` fields in the TypeScript type.
- No code verifies manifest signatures, artifact signatures, signing key identity, sequence monotonicity, or manifest expiry.
- Remote manifests from the control plane are normalized and accepted if they contain usable entries.

Risk:

- A compromised control-plane endpoint, gateway, DNS route, or build pipeline could redirect clients to a malicious binary as long as size and SHA-256 in the same untrusted manifest match.

Recommendation:

- Ship a trusted public key or trust-key set in the app.
- Require signed remote manifests before use.
- Add `sequence`, `publishedAt`, `expiresAt`, `minAppVersion`, `maxAppVersion`, and `revokedArtifacts`.
- Persist highest accepted `sequence` to block silent rollback.
- Continue SHA-256 verification on the downloaded artifact after signature verification.

### P0: Publish the manifest to IPFS/IPNS, not only binaries

Current state:

- `publish-runtime-artifacts-ipfs.js` uploads binaries and writes `bootstrap.json`.
- It does not upload the combined manifest, pin that manifest, publish IPNS, or update DNSLink.

Risk:

- App updates can only discover newer binaries through the control-plane HTTP endpoint or through a new desktop build containing a new bootstrap manifest.
- The desired "single mutable manifest name" is not implemented.

Recommendation:

- After binary upload, write a signed release manifest.
- Upload and pin the release manifest to IPFS.
- Publish the manifest CID to a dedicated IPNS key.
- Optionally map `runtimes.prometheusags.ai` to that IPNS name with DNSLink.
- Keep HTTPS manifest fallback for enterprise networks and gateway outages.

### P0: Stop eager startup downloads

Current state:

- `managedRuntimeService.reconcile()` runs during startup.
- It attempts to install UAR, OpenCode, and Codex whether or not the user will use them.

Risk:

- Startup can trigger large downloads, disk writes, retries, gateway timeouts, and hash verification.
- This can look like runaway CPU/network usage, especially on slow disks or failed IPFS gateways.

Recommendation:

- Replace startup reconcile with a lightweight manifest/status check.
- Download only when the user selects a runtime, starts a session requiring that runtime, or explicitly clicks install/update.
- Add a per-runtime auto-update preference defaulting to off or "only on idle and AC power."
- Serialize installs per runtime and expose cancellation through IPC.

### P0: Prefer verified managed binaries over PATH binaries

Current state:

- UAR, Codex, and OpenCode resolve PATH-discovered binaries before verified managed binaries.

Risk:

- A stale or unrelated binary on PATH can override the verified app-managed binary.
- This makes support and reproducibility worse and weakens the supply-chain model.

Recommendation:

- Resolution order should be:
  1. explicit user-configured path
  2. explicit environment override
  3. verified managed binary
  4. PATH discovery only if the user has enabled "use system binary"
  5. development checkout only in dev builds
- Show source in UI and telemetry.

### P0: Add sidecar resource supervision

Current state:

- UAR and OpenCode sidecars are spawned and stopped on app quit.
- OpenCode caches servers by `cwd + config` and stops them on dispose.
- There is no visible CPU/memory accounting, process restart budget, idle timeout, orphan detection, or per-runtime kill/escalation policy beyond UAR's 3 second SIGKILL fallback.

Risk:

- A stuck sidecar can consume CPU or memory until app quit.
- Multiple OpenCode configurations/workspaces can leave multiple sidecars running.
- Startup failures and health failures do not produce enough process diagnostics for user support.

Recommendation:

- Introduce a `SidecarProcessSupervisor` shared by UAR, OpenCode, Codex app-server, and future sidecars.
- Track pid, start time, cwd, binary version, memory RSS, CPU sample, health state, restart count, and last stderr lines.
- Enforce idle shutdown after configurable inactivity.
- Enforce start failure backoff and max restart budget.
- Add explicit stop/kill IPC and UI status.
- On macOS/Linux, kill process groups where appropriate to avoid child orphans.

### P1: Build a cross-platform release matrix

Current state:

- `build-runtime-artifacts.js` builds only the current host platform.
- Current `bootstrap.json` contains only `darwin-arm64`.

Risk:

- The app cannot reliably install managed runtimes on Windows, Linux, or Intel macOS from the checked-in bootstrap manifest.

Recommendation:

- Move runtime artifact builds into CI matrix jobs for `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`, and `win32-arm64` where supported.
- Merge all platform manifests into one signed release manifest.
- Fail the release if a required platform artifact is missing.

### P1: Package artifacts as archives

Current state:

- The publisher uploads raw executable files.

Risk:

- Raw executable distribution is awkward for signatures, metadata, quarantine handling, compression, and future multi-file runtimes.

Recommendation:

- Publish `tar.zst` or `zip` archives with:
  - executable
  - metadata JSON
  - license/notice
  - detached signature
  - optional SBOM
- Verify archive hash and extracted binary hash before install.

### P1: Improve offline and failure behavior

Current state:

- Download failures become `download-failed`.
- Missing binaries block the selected runtime but do not block the whole app.
- There is no offline install package or "last known good" manifest policy documented in code.

Recommendation:

- Cache the last verified manifest and installed binaries.
- If manifest refresh fails, use the last verified installed version.
- If install fails, leave the previous verified version active.
- Never delete a working binary before the replacement is verified and atomically promoted.
- Add manual import of a signed runtime archive for offline environments.
- Surface clear states: offline, gateway unavailable, manifest signature failed, artifact verification failed, previous version retained.

### P1: Complete macOS signing/notarization strategy

Current state:

- App packaging has `notarize: false`.
- Managed runtime artifacts do not record notarization, code-signing identity, or signature verification.

Risk:

- Downloaded sidecar executables may hit Gatekeeper, quarantine, or enterprise policy issues.
- Signing only the app bundle is not enough for mutable downloaded executables stored in app data.

Recommendation:

- Sign each macOS sidecar with Developer ID during CI.
- Notarize the sidecar archive or executable before publishing.
- Record signing identity and Team ID in the manifest.
- Verify macOS code signature locally before execution where feasible.
- Keep detached manifest signature verification as the app-level trust gate.

## Recommended Change Set

1. `change-019-signed-runtime-channel-manifest`
   - Add manifest v2 schema.
   - Add signature verification and rollback protection.
   - Persist last accepted sequence and last verified manifest.
   - Require signed remote manifest for production.

2. `change-020-ipns-dnslink-runtime-manifest-publish`
   - Upload signed release manifest to IPFS.
   - Pin manifest and artifacts.
   - Publish IPNS from a dedicated key.
   - Document DNSLink setup for `runtimes.prometheusags.ai`.
   - Keep HTTPS fallback.

3. `change-021-on-demand-runtime-install-policy`
   - Remove startup eager reconcile.
   - Add lazy install/update behavior keyed to runtime selection/session start.
   - Add cancelable install operations and idle-safe auto-update policy.

4. `change-022-managed-binary-resolution-trust-order`
   - Prefer verified managed binaries over PATH discovery.
   - Gate PATH discovery behind explicit user preference or explicit path configuration.
   - Update docs/tests to match implementation.

5. `change-023-sidecar-process-supervisor`
   - Add shared process supervisor with idle timeout, resource telemetry, restart budget, kill escalation, and orphan cleanup.
   - Wire UAR and OpenCode through it first.

6. `change-024-runtime-release-matrix`
   - Build all supported platform artifacts in CI.
   - Merge per-platform manifests.
   - Sign/notarize platform artifacts.
   - Fail release on missing required platform.

## Acceptance Criteria

- The DMG does not contain UAR, OpenCode, or Codex sidecar binaries except explicit offline/dev fallback builds.
- The shipped app can resolve a stable manifest name through DNSLink/IPNS and can fall back to HTTPS.
- The app rejects unsigned, expired, rollback, wrong-platform, wrong-size, and wrong-hash manifests/artifacts.
- The app can launch without network access and without any managed runtime installed.
- Selecting a runtime with no installed binary produces a clear install/update state, not an app-level failure.
- A failed download leaves the previous verified version intact.
- A sidecar consuming excessive CPU/memory is visible in Runtime Settings and can be stopped.
- UAR, OpenCode, and Codex managed binaries are available for the supported platform matrix.

## Verification Plan

- Unit tests for manifest signature verification, sequence rollback, expiry, unsupported platform, bad hash, bad size, gateway fallback, and HTTPS fallback.
- Integration test with a local Kubo-compatible mock that publishes a manifest CID and updates an IPNS/DNSLink-like pointer.
- Renderer tests for offline, missing, failed download, verification failed, update available, installed, and previous-version-retained states.
- Sidecar supervisor tests for idle shutdown, restart budget, SIGTERM/SIGKILL escalation, and process-group cleanup.
- Packaged app audit proving sidecars are absent from DMG/app resources in production mode.
- Real packaged smoke on macOS arm64: clean install, offline launch, managed install from IPFS, UAR chat, failed gateway fallback, app quit cleanup.

## Assessment Verdict

The proposed architecture is directionally correct, and the codebase already has the core managed-binary foundation. The next step should not be more ad hoc IPFS CID embedding. The next step should be a signed channel manifest distributed through IPNS/DNSLink with HTTPS fallback, plus on-demand install policy and sidecar supervision. Those pieces directly address the user's reported pain: install failures, large DMGs, brittle sidecar updates, memory leaks, and runaway CPU behavior.

ASSESSMENT COMPLETE
