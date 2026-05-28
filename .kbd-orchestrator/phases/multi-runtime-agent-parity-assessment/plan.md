# PLAN: resilient managed sidecar distribution

Project: The Boss / Cherry Studio fork
Date: 2026-05-26T10:48:06Z
Phase: `multi-runtime-agent-parity-assessment`
Backend: native KBD
Assessment: `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/binary-distribution-assessment.md`
OpenSpec available: NO
Evolver bridge: NO
Changes to implement: 6

## Scope

This plan supersedes the completed `change-010` through `change-018` phase plans for the next execution round only. Prior runtime parity and managed-binary work remains recorded in `execution.md`, `reflection.md`, `binary-distribution-plan.md`, and `progress.json`.

The new scope is resilient sidecar distribution: signed channel manifests, IPNS/DNSLink publishing, on-demand installs, verified binary precedence, process supervision, and a cross-platform release matrix.

## Change List

1. `change-019-signed-runtime-channel-manifest`: Add signed manifest trust and rollback protection
   - Scope: main runtime manifest provider | manifest schema | app-data cache | tests
   - Depends on: `change-018-ipfs-transport-release-workflow`
   - Recommended agent: Codex
   - Est. complexity: L
   - Customer value: HIGH
   - Details: Add manifest v2 with sequence, expiry, app-version bounds, revocations, artifact metadata, and signature verification. Persist the highest accepted sequence and last verified manifest. Reject unsigned production manifests and rollback attempts.

2. `change-020-ipns-dnslink-runtime-manifest-publish`: Publish signed runtime manifests through IPFS/IPNS/DNSLink
   - Scope: release scripts | manifest resolver | docs | tests
   - Depends on: `change-019-signed-runtime-channel-manifest`
   - Recommended agent: Codex
   - Est. complexity: M
   - Customer value: HIGH
   - Details: Upload the signed release manifest to IPFS, optionally publish a dedicated IPNS key, document DNSLink for `runtimes.prometheusags.ai`, and let the app resolve the latest manifest through IPNS/DNSLink with HTTPS fallback.

3. `change-021-on-demand-runtime-install-policy`: Stop eager startup downloads
   - Scope: app startup | managed runtime service | IPC progress/cancel | tests
   - Depends on: `change-019-signed-runtime-channel-manifest`
   - Recommended agent: Codex
   - Est. complexity: M
   - Customer value: HIGH
   - Details: Remove or gate startup `managedRuntimeService.reconcile()`. Make installs explicit or lazy on runtime use, serialize per-runtime operations, expose cancellation, and preserve previous verified binaries after failed updates.

4. `change-022-managed-binary-resolution-trust-order`: Prefer verified managed binaries over PATH
   - Scope: UAR | Codex | OpenCode resolution | settings labels | docs | tests
   - Depends on: `change-021-on-demand-runtime-install-policy`
   - Recommended agent: Codex
   - Est. complexity: M
   - Customer value: HIGH
   - Details: Change resolution order to explicit configured path, explicit environment override, verified managed binary, user-enabled PATH discovery, then development checkout in dev only.

5. `change-023-sidecar-process-supervisor`: Add supervised sidecar lifecycle and resource reporting
   - Scope: main runtime services | IPC status | renderer settings | tests
   - Depends on: `change-022-managed-binary-resolution-trust-order`
   - Recommended agent: Codex
   - Est. complexity: L
   - Customer value: HIGH
   - Details: Add a shared supervisor for UAR, OpenCode, Codex app-server probes, and future sidecars with pid/resource status, idle shutdown, restart budget, kill escalation, process-group cleanup, and UI-visible stop/kill controls.

6. `change-024-runtime-release-matrix`: Build signed archived runtime artifacts for supported platforms
   - Scope: CI/release scripts | artifact packaging | docs | packaged audit
   - Depends on: `change-020-ipns-dnslink-runtime-manifest-publish`, `change-023-sidecar-process-supervisor`
   - Recommended agent: Codex
   - Est. complexity: L
   - Customer value: MEDIUM
   - Details: Produce `tar.zst` or `zip` runtime archives for supported platforms, include metadata/license/signature/SBOM where available, sign/notarize macOS artifacts, merge platform metadata, and fail release on incomplete artifacts.

## Execution Round Order

Round 1: `change-019-signed-runtime-channel-manifest`
Round 2: `change-020-ipns-dnslink-runtime-manifest-publish` and `change-021-on-demand-runtime-install-policy`
Round 3: `change-022-managed-binary-resolution-trust-order`
Round 4: `change-023-sidecar-process-supervisor`
Round 5: `change-024-runtime-release-matrix`

## Commands To Run

Native KBD changes:

```bash
sed -n '1,220p' .kbd-orchestrator/changes/change-019-signed-runtime-channel-manifest/change.md
```

Required final gates:

```bash
pnpm format
pnpm lint
pnpm test
pnpm build:mac:arm64
git diff --check
```

## Sycophancy Self-Check

PASS. The plan does not claim the current IPFS implementation is production-complete. It calls out the missing trust root, IPNS/DNSLink publish flow, startup download policy, PATH precedence issue, process supervision gap, and platform matrix gap as explicit work.

PLAN COMPLETE
