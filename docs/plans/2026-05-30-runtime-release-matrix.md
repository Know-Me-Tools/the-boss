# Runtime Release Matrix Implementation Plan (change-024)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans / subagent-driven-development to implement task-by-task.

**Goal:** Turn runtime artifact publishing into a supported-platform release matrix with archived artifacts, enriched signed manifests (archive + binary hashes, signing identity, Team ID, notarization), per-platform merge, and release gates. CI/credential/cross-compile-bound paths are env-gated and fixture-tested (not executed against 6 real platforms or real Apple creds in dev).

**Architecture:** Extend existing scripts (`build-runtime-artifacts.js`, `build-managed-binary-manifest.js`, `publish-runtime-artifacts-ipfs.js`); add a shared platform-matrix constant + a Zod manifest schema; gate CI-only paths behind env/flags.

**Tech Stack:** Node ESM scripts, Vitest, Zod. Node ≥24.11 (use `~/.nvm/versions/node/v24.16.0/bin`). Commit `--signoff`. Branch `change/024-runtime-release-matrix`. Never `v2`.

**Design doc:** this file. Exploration confirmed substantial tooling already exists from changes 018/020; this is the DELTA.

---

## Task 1: Platform matrix constant

**Files:** Create `scripts/runtime-platform-matrix.js` + `scripts/__tests__/runtime-platform-matrix.test.ts`.

`MANAGED_RUNTIME_PLATFORM_MATRIX`: maps `'uar' | 'opencode' | 'codex'` → array of `platform-arch` triples (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`, `win32-arm64`) with per-runtime exceptions encoded explicitly. Helpers: `getSupportedPlatforms(runtime)`, `isPlatformSupported(runtime, platform)`, `requiredPlatformsFor(runtime)`. TDD: tests assert the matrix shape, exceptions, and helper behavior. Commit.

## Task 2: Archive packaging in build-runtime-artifacts

**Files:** `scripts/build-runtime-artifacts.js` + test.

Add an `archiveRuntimeArtifact()` step: after a binary builds, assemble an archive (`tar.zst` on unix, `zip` on win32) containing executable + metadata JSON + license/notice (+ optional SBOM if present). Emit `archiveSha256`, `archiveSize` alongside binary `sha256`/`size`/`maxSize` in the per-runtime manifest object. Keep single-host build behavior (cross-compile loop is CI matrix, not run here) but make the archive step parameterized by platform so CI can call it per-matrix-entry. TDD with a fake binary in a temp dir; assert archive created + hashes recorded. Commit.

## Task 3: Manifest schema (Zod) + enriched fields

**Files:** `scripts/build-managed-binary-manifest.js` (+ a `scripts/runtime-manifest-schema.js` Zod module) + the existing `build-managed-binary-manifest.test.ts`.

Add a Zod schema for manifest entries with new optional fields: `archiveSha256`, `archiveSize`, `signingIdentity`, `teamId`, `notarization` (e.g. `{ notarized: boolean, ticketId?: string }`), keeping existing `size`/`maxSize`/`sha256`/`ipfsCid`/`httpsUrl`/`signatures`. `buildManifestEntry` populates/validates them. TDD: extend existing tests to cover new fields + schema validation (reject malformed). Commit.

## Task 4: Per-platform manifest merge

**Files:** `scripts/build-managed-binary-manifest.js` (add a `mergeManifests`/`--merge` mode) + test.

Merge N per-platform manifests for the same runtime into one with combined `supportedPlatforms` + `binaries[]`, validated by the Zod schema; reject duplicate-platform or runtime-name mismatch. TDD. Commit.

## Task 5: Release gates in publish

**Files:** `scripts/publish-runtime-artifacts-ipfs.js` + the existing `publish-runtime-artifacts-ipfs.test.ts`.

Before signing the channel manifest, add `assertReleaseComplete()`: for each runtime, assert all REQUIRED platforms (from the matrix) are present, each entry has binary+archive hashes, signatures present, and macOS entries carry notarization metadata (when `REQUIRE_MAC_NOTARIZATION`/CI flag set). Fail with a clear error listing what's missing. Add a `--dry-run` flag that runs build+gate without uploading/publishing. TDD: gate passes on a complete fixture, fails on a missing-platform / missing-hash / missing-notarization fixture. Commit.

## Task 6: Env-gated macOS sign + notarize for runtime binaries

**Files:** `scripts/build-runtime-artifacts.js` (or a small `scripts/sign-runtime-artifact.js` helper) + test.

A `signAndNotarizeMacArtifact()` helper gated behind `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` (no-op + log when absent, mirroring `notarize.js`). On macOS entries it `codesign`s the binary and records `signingIdentity`/`teamId`/`notarization` into the manifest entry. TDD: with creds absent → no-op, fields unset; with a mocked signer (injected) → fields populated. Do NOT call real codesign/notarize. Commit.

## Task 7: Docs + verification + bookkeeping

**Files:** `docs/en/guides/agent-runtimes.md`; `.kbd-orchestrator/changes/change-024-*/change.md`; phase `progress.json`.

Docs: supported-platform matrix table, dry-run instructions, production publish flow, platform-support exceptions, release-gate failure semantics, runtime-artifact macOS signing/notarization (distinct from app notarization). Then run verification:
```
pnpm vitest run scripts/__tests__/build-managed-binary-manifest.test.ts scripts/__tests__/verify-packaged-runtime-deps.test.ts scripts/__tests__/publish-runtime-artifacts-ipfs.test.ts scripts/__tests__/runtime-platform-matrix.test.ts
pnpm run typecheck:node
git diff --check
```
Note `pnpm build:mac:arm64` is CI-only (full electron-builder mac build; not run in dev — documented). Mark change-024 DONE; update progress.json (phase execution_complete once 024 lands). Commit. Push; open PR → main via gh-create-pr.
