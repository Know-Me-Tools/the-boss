# change-024-runtime-release-matrix

Status: TODO
Priority: P1
Assigned backend: Codex
Depends on: `change-020-ipns-dnslink-runtime-manifest-publish`, `change-023-sidecar-process-supervisor`

## Goal

Turn runtime artifact publishing into a supported-platform release matrix with archived artifacts, signatures, macOS signing/notarization metadata, and release gates.

## Tasks

- [ ] Define the supported platform matrix for UAR, OpenCode, and Codex managed binaries.
- [ ] Build runtime artifacts for `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`, and `win32-arm64` where supported.
- [ ] Package artifacts as `tar.zst` or `zip` archives instead of raw executables.
- [ ] Include executable, metadata JSON, license/notice, detached signature, and optional SBOM in each archive.
- [ ] Sign and notarize macOS runtime artifacts in CI where credentials are available.
- [ ] Record signing identity, Team ID, archive hash, extracted binary hash, size, max size, and CID in the signed manifest.
- [ ] Merge per-platform metadata into one signed channel manifest.
- [ ] Fail release when required platform artifacts, hashes, signatures, or notarization metadata are missing.
- [ ] Add release docs for dry runs, production publishing, and platform support exceptions.

## Acceptance Criteria

- [ ] A single signed manifest contains all supported platform artifacts.
- [ ] Production publishing cannot silently omit required platform artifacts.
- [ ] macOS runtime artifacts have an explicit signing/notarization path.
- [ ] The packaged app audit confirms production sidecars are not bundled in the DMG.

## Verification

- `pnpm vitest run scripts/__tests__/build-managed-binary-manifest.test.ts scripts/__tests__/verify-packaged-runtime-deps.test.ts`
- `pnpm build:mac:arm64`
- `git diff --check`

