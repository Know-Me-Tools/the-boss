# change-020-ipns-dnslink-runtime-manifest-publish

Status: DONE
Priority: P0
Assigned backend: Codex
Depends on: `change-019-signed-runtime-channel-manifest`

## Goal

Publish the signed runtime release manifest itself to IPFS and expose it through a stable mutable IPNS/DNSLink name with HTTPS fallback.

## Tasks

- [x] Update runtime artifact publishing to write a signed release manifest after binaries are uploaded.
- [x] Upload and pin the signed release manifest to IPFS.
- [x] Add optional IPNS publish support using a dedicated runtime-channel key.
- [x] Add app-side resolution for DNSLink/IPNS manifest names through configured gateways.
- [x] Keep HTTPS manifest fallback for networks where IPFS/IPNS gateways are blocked.
- [x] Document DNSLink setup for `_dnslink.runtimes.prometheusags.ai`.
- [x] Document release operator steps for pinning, IPNS key management, CID verification, and fallback promotion.
- [x] Add tests for manifest upload, IPNS publish command construction, DNSLink/IPNS resolution fallback, and HTTPS fallback.

## Acceptance Criteria

- [x] A new signed runtime manifest can be published without rebuilding the Electron app.
- [x] The app can resolve the latest signed manifest from a stable IPNS/DNSLink name.
- [x] IPNS/DNSLink failure does not block use of HTTPS fallback or last verified manifest.
- [x] Immutable artifact CIDs remain inside the signed manifest.

## Verification

- `pnpm vitest run scripts/__tests__/build-managed-binary-manifest.test.ts src/main/services/agents/services/runtime/__tests__/ManagedRuntimeService.test.ts`
- `pnpm run typecheck:node`
- `git diff --check`

## Results

- Runtime artifact publishing now uploads binaries, writes and signs a channel manifest, uploads and pins that manifest, optionally publishes IPNS, and records the immutable manifest CID in the bootstrap manifest.
- The main runtime manifest provider resolves signed channel manifests through configured IPNS/DNSLink gateway URLs before falling back to HTTPS and the control-plane endpoint.
- Operator documentation now covers DNSLink, release signing, IPNS key use, CID verification, and fallback promotion.
- Verification passed: focused Vitest coverage, node typecheck, `pnpm format`, `pnpm lint`, full `pnpm test`, and `git diff --check`.
- Artifact-refiner QA skipped because this repository has no artifact-refiner input manifest or constraints file for the native KBD change.
