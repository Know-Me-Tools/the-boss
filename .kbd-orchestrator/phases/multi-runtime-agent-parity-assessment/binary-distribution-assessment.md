# ASSESSMENT: binary distribution for embedded runtimes

Project: The Boss / Cherry Studio fork
Date: 2026-04-18T16:35:00Z
Question: Should compiled Universal Agent Runtime and other embedded binaries be pulled on demand from IPFS or another content-addressed artifact store instead of being packaged with the application?

## Executive Assessment

Yes, this should be considered, but it should not be the first fix for the 5 GB app size.

The immediate size problem is primarily packaging scope, not just embedded binaries. The current packaged app is about 5.0 GB because `electron-builder.yml` includes nearly the entire repository with `files: "**/*"` and does not exclude `vendor/**`. The built app contains:

- `dist/mac-arm64/The Boss.app`: 5.0 GB
- `Contents/Resources/app.asar`: 3.8 GB
- `Contents/Resources/app.asar.unpacked`: 522 MB
- `Contents/Resources/node_modules`: 433 MB
- `resources/binaries/darwin-arm64/universal-agent-runtime`: 120 MB
- `resources/binaries/darwin-arm64/rtk`: 6.7 MB

The vendored UAR checkout is about 3.7 GB in the workspace, with `vendor/universal-agent-runtime/target` alone about 3.6 GB and `vendor/universal-agent-runtime/target/release/deps` about 3.0 GB. `app.asar` contains `/vendor/universal-agent-runtime`, so the build is shipping Rust build artifacts and source/vendor material that should not be in the user app at all.

Conclusion:

- P0: exclude `vendor/**` and other build-only material from the packaged app.
- P1: move large optional managed binaries, starting with UAR, to an on-demand content-addressed install/update mechanism.
- P1/P2: consider IPFS as one backend for artifact transport, but keep a signed manifest and HTTPS fallback so app startup and enterprise networks are reliable.

## Current Code Evidence

Packaging config:

- `electron-builder.yml` includes `files: "**/*"`.
- It excludes `docs`, `scripts`, `packages`, and many source patterns, but does not exclude `vendor/**`.
- It explicitly includes `resources/**/*`.
- It unpacks `resources/**` via `asarUnpack`.

Current embedded binary paths:

- UAR default path is resolved by `UniversalAgentRuntimeService.resolveBinaryPath()` from `getResourcePath()/binaries/<platform-arch>/universal-agent-runtime`.
- UAR can be overridden with `runtimeConfig.sidecar.binaryPath` or `UAR_SIDECAR_PATH`.
- RTK is downloaded during `beforePack` by `scripts/download-rtk-binaries.js`, placed under `resources/binaries/<platform-arch>/rtk`, then copied to `~/.theboss/bin` at runtime by `extractRtkBinaries()`.

Existing useful patterns:

- RTK already has a platform-keyed binary concept and a runtime-managed user bin directory.
- UAR already has version metadata at `.uar-version` with source commit, expected commit, platform key, and binary name.
- UAR already has a runtime status state for `missing-binary`.
- UAR already supports user override paths.

## Fit Of On-Demand Binary Distribution

The proposed design is a good fit for UAR and similar optional managed tools because:

- Only one platform/architecture binary is needed at runtime.
- UAR is optional unless the user selects embedded UAR.
- Runtime binaries can be updated independently of the Electron app if the app stores a manifest and validates the artifact before execution.
- The app already has a data directory and a precedent for managed dependencies under `~/.theboss/bin`.

The design should use content-addressed binary manifests whether or not IPFS is the first transport:

```json
{
  "name": "universal-agent-runtime",
  "version": "0.1.0",
  "sourceCommit": "c7c8416b94d39358ec7cf03691738426c25b2df8",
  "platforms": {
    "darwin-arm64": {
      "binary": "universal-agent-runtime",
      "sha256": "...",
      "size": 125000000,
      "cid": "bafy...",
      "httpsUrl": "https://.../universal-agent-runtime-darwin-arm64.tar.zst",
      "signature": "..."
    }
  }
}
```

Runtime install location should be inside app data, for example:

```text
<userData>/Data/managed-binaries/universal-agent-runtime/<version>/<platform-arch>/universal-agent-runtime
<userData>/Data/managed-binaries/universal-agent-runtime/<version>/<platform-arch>/manifest.json
```

Resolution order should be:

1. Explicit runtime config `sidecar.binaryPath`.
2. `UAR_SIDECAR_PATH`.
3. Verified user-managed binary in app data.
4. Bundled binary fallback, if present.
5. Download/install prompt.

## IPFS-Specific Assessment

IPFS is useful as a content-addressed distribution backend, but it should not be the only source.

Benefits:

- Content IDs make artifact identity stable and cacheable.
- Users only fetch the current OS/arch artifact.
- Updating binaries can be manifest-driven without full app redistribution.
- Multiple gateways or local IPFS nodes can reduce central hosting reliance.

Risks:

- Public gateway availability and latency are variable.
- Enterprise networks may block IPFS gateways.
- IPFS content addressing does not replace application-level trust. The app still needs a signed manifest and hash verification.
- macOS downloaded executables may need signing/notarization strategy and quarantine handling. The app should not run unsigned unverified binaries from user-writable locations.
- Update rollback and compromised-manifest handling need an explicit policy.

Recommendation:

- Use a signed manifest as the trust root.
- Treat IPFS CID as a transport/content-address field, not as the sole security control.
- Provide HTTPS fallback from an owned release bucket or GitHub Releases.
- Verify SHA-256 before chmod/execute.
- Verify a detached signature or signed manifest before accepting a binary.
- Keep the current bundled-binary path as a transitional fallback only for developer builds or offline mode.

## What Should Change First

### P0: Fix Packaging Scope

Add packaging exclusions so build-only vendor material never enters `app.asar`:

- `!vendor/**`
- `!.kbd-orchestrator/**` unless intentionally shipped
- `!.refiner/**`
- `!dist/**` if not already excluded by electron-builder defaults
- any generated build cache directories introduced by submodules

This single change should remove most of the 3.8 GB `app.asar` growth. It is higher ROI than remote binary delivery because the UAR executable itself is only 120 MB.

### P0: Keep Only Target Platform Runtime Binaries

The existing `beforePack` logic already excludes non-target `resources/binaries/<platform-arch>` paths for RTK. Extend the same discipline to all managed binaries.

The packaged app should never include every OS/arch binary.

### P1: Introduce Managed Binary Registry

Create a shared managed binary service for:

- UAR
- RTK
- future embedded runtimes or helper tools

Responsibilities:

- resolve platform key
- read signed manifest
- check installed binary version/hash
- download from preferred transport
- verify hash/signature
- install atomically into app data
- chmod executable on Unix
- expose status/progress through IPC
- refuse execution if verification fails

### P1: Convert UAR Embedded To On-Demand

Change `UniversalAgentRuntimeService.resolveBinaryPath()` from “bundled binary must exist” to “resolve or install a verified binary”.

User-facing states should include:

- not installed
- downloading
- verifying
- installed
- update available
- verification failed
- download failed
- unsupported platform

The runtime settings UI should provide an explicit install/update action before launching embedded UAR.

### P2: Add IPFS Transport

Implement IPFS as one transport behind the managed binary service:

- `ipfsGatewayUrls[]`
- CID from signed manifest
- optional local gateway support
- retry/fallback to HTTPS
- telemetry that reports transport class, not secrets or full URLs with tokens

## Security Requirements

Do not run arbitrary downloaded binaries based only on URL or CID.

Minimum required controls:

- signed manifest shipped with app or fetched from a trusted signed update channel
- SHA-256 validation of archive and extracted binary
- platform/arch allowlist
- expected binary name allowlist
- max download size
- atomic install to temp path, then rename
- executable permission set only after validation
- code signing/notarization strategy for macOS binaries
- version rollback protection unless user explicitly opts into downgrade
- clear offline/error UI

## Build And Release Impact

Expected benefits after P0 packaging cleanup:

- App size should drop by multiple gigabytes because `vendor/universal-agent-runtime/target` no longer ships.
- The UAR binary can still be bundled temporarily while the on-demand service is built.

Expected benefits after P1/P2:

- Base app no longer grows with optional runtime binaries.
- Runtime binary updates can happen independently from app releases.
- Users only download binaries for their detected OS/arch.

Tradeoffs:

- First use of embedded UAR requires network access unless bundled fallback remains.
- Offline installation becomes a separate flow.
- Release engineering must publish binary manifests and artifacts.
- Support/debugging needs better binary status and log collection.

## Assessment Verdict

Proceed, but in this order:

1. Exclude `vendor/**` and other build-only directories from packaged app.
2. Keep `resources/binaries` platform-filtered and audit all bundled native/helper binaries.
3. Build a generic managed binary installer with signed manifest/hash validation.
4. Move UAR embedded binary resolution to that installer.
5. Add IPFS as an optional content-addressed transport with HTTPS fallback.
6. Remove bundled UAR from production packaging once the install/update path is reliable.

Do not solve this by only moving UAR to IPFS. That would save about 120 MB but leave the dominant 3.7 GB vendor packaging bug intact.

ASSESSMENT COMPLETE
