# change-024-runtime-release-matrix

Status: DONE
Priority: P1
Assigned backend: claude-code (subagent-driven TDD)
Depends on: `change-020-ipns-dnslink-runtime-manifest-publish`, `change-023-sidecar-process-supervisor`

## Goal

Turn runtime artifact publishing into a supported-platform release matrix with archived artifacts, signatures, macOS signing/notarization metadata, and release gates.

## Tasks

- [x] Define the supported platform matrix for UAR, OpenCode, and Codex managed binaries. (`scripts/runtime-platform-matrix.js` + `resolveRuntimeKey` display-name↔key bridge.)
- [x] Build runtime artifacts for all 6 platforms where supported. (Matrix-parameterized; cross-compile loop runs in CI per-matrix-entry — build function takes target `platform`.)
- [x] Package artifacts as `tar.zst` (unix) / `zip` (win32) archives instead of raw executables. (Byte-reproducible: constant mtime, sorted members, zeroed uid/gid.)
- [x] Include executable, metadata JSON, license/notice, detached signature, and optional SBOM in each archive.
- [x] Sign and notarize macOS runtime artifacts in CI where credentials are available. (Env-gated `scripts/sign-runtime-artifact.js`; no-op without Apple creds; fixture-tested.)
- [x] Record signing identity, Team ID, archive hash, extracted binary hash, size, max size, and CID in the signed manifest. (Zod schema in `scripts/runtime-manifest-schema.js`.)
- [x] Merge per-platform metadata into one signed channel manifest. (`mergeManifests` + `--merge` CLI.)
- [x] Fail release when required platform artifacts, hashes, signatures, or notarization metadata are missing. (`assertReleaseComplete` gate + `--dry-run`; closes unknown-name / array-sig / empty-release bypasses.)
- [x] Add release docs for dry runs, production publishing, and platform support exceptions. (`docs/en/guides/agent-runtimes.md` "Release Matrix" section.)

## Scope note

Per environment constraints, CI/credential/cross-compile-bound paths (the 6-platform cross-compile, macOS sign/notarize with real Apple creds, and the full `pnpm build:mac:arm64` electron-builder build) are implemented as env-gated, fixture-tested code — they run in CI on native runners, not in local dev. All script logic, the matrix, gates, schema, merge, and docs are implemented and unit-tested here.

## Acceptance Criteria

- [ ] A single signed manifest contains all supported platform artifacts.
- [ ] Production publishing cannot silently omit required platform artifacts.
- [ ] macOS runtime artifacts have an explicit signing/notarization path.
- [ ] The packaged app audit confirms production sidecars are not bundled in the DMG.

## Verification

- `pnpm vitest run scripts/__tests__/build-managed-binary-manifest.test.ts scripts/__tests__/verify-packaged-runtime-deps.test.ts`
- `pnpm build:mac:arm64`
- `git diff --check`

