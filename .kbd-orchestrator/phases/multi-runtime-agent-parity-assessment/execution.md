# EXECUTION: multi-runtime-agent-parity-assessment

Project: The Boss / Cherry Studio fork
Date: 2026-05-26T10:48:06Z
Selected backend: native-tool
Dispatched to: SELF
Backend rationale: OpenSpec is not available, and the resilient sidecar distribution plan is decomposed into bounded native KBD changes. Codex can execute the next pending change directly while maintaining `progress.json` as the source of truth.
Backend entrypoint: `$kbd-execute` / active waypoint
OpenSpec available: NO
Source plan: `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/plan.md`

## Execution Scope

- `change-019-signed-runtime-channel-manifest`: Add signed runtime channel manifest trust and rollback protection.
- `change-020-ipns-dnslink-runtime-manifest-publish`: Publish signed runtime manifests through IPFS/IPNS/DNSLink.
- `change-021-on-demand-runtime-install-policy`: Stop eager startup downloads and make installs explicit/lazy.
- `change-022-managed-binary-resolution-trust-order`: Prefer verified managed binaries over PATH discovery.
- `change-023-sidecar-process-supervisor`: Add sidecar lifecycle/resource supervision.
- `change-024-runtime-release-matrix`: Build signed archived runtime artifacts for supported platforms.

## Dispatch Contracts

- `change-019-signed-runtime-channel-manifest` -> SELF
  Entry: Implement `.kbd-orchestrator/changes/change-019-signed-runtime-channel-manifest/change.md`
  Progress file: `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json`
  Handoff: Update status/tasks/verification in progress.json and refresh current-waypoint files.

- `change-020-ipns-dnslink-runtime-manifest-publish` -> SELF
  Entry: Implement `.kbd-orchestrator/changes/change-020-ipns-dnslink-runtime-manifest-publish/change.md` after change-019 is DONE.
  Progress file: `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json`
  Handoff: Update status/tasks/verification in progress.json and refresh current-waypoint files.

- `change-021-on-demand-runtime-install-policy` -> SELF
  Entry: Implement `.kbd-orchestrator/changes/change-021-on-demand-runtime-install-policy/change.md` after change-019 is DONE.
  Progress file: `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json`
  Handoff: Update status/tasks/verification in progress.json and refresh current-waypoint files.

- `change-022-managed-binary-resolution-trust-order` -> SELF
  Entry: Implement `.kbd-orchestrator/changes/change-022-managed-binary-resolution-trust-order/change.md` after change-021 is DONE.
  Progress file: `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json`
  Handoff: Update status/tasks/verification in progress.json and refresh current-waypoint files.

- `change-023-sidecar-process-supervisor` -> SELF
  Entry: Implement `.kbd-orchestrator/changes/change-023-sidecar-process-supervisor/change.md` after change-022 is DONE.
  Progress file: `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json`
  Handoff: Update status/tasks/verification in progress.json and refresh current-waypoint files.

- `change-024-runtime-release-matrix` -> SELF
  Entry: Implement `.kbd-orchestrator/changes/change-024-runtime-release-matrix/change.md` after change-020 and change-023 are DONE.
  Progress file: `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json`
  Handoff: Update status/tasks/verification in progress.json and refresh current-waypoint files.

## Approval Gates

- Do not use `v2`.
- Do not add Redux slices or modify IndexedDB schema without explicit approval.
- Do not run downloaded binaries unless manifest and hash verification pass.
- Do not make IPFS the only binary transport; HTTPS fallback is mandatory.
- Do not accept unsigned production runtime channel manifests.
- Do not perform large managed-runtime downloads during app startup by default.

## Verification Requirements

- `change-019`: manifest verification unit tests, managed runtime fallback tests, `pnpm run typecheck:node`, `git diff --check`.
- `change-020`: publisher tests, IPNS/DNSLink resolver tests, `pnpm run typecheck:node`, `git diff --check`.
- `change-021`: runtime control tests, managed binary install policy tests, `pnpm run typecheck:node`, `git diff --check`.
- `change-022`: UAR/Codex/OpenCode resolution tests, renderer source label tests, node/web typechecks, `git diff --check`.
- `change-023`: sidecar supervisor tests, UAR/OpenCode integration tests, renderer status tests, node/web typechecks, `git diff --check`.
- `change-024`: release script tests, packaged runtime audit, `pnpm build:mac:arm64`, `git diff --check`.

## Progress Ledger

- [DONE] `change-019-signed-runtime-channel-manifest` - SELF
- [DONE] `change-020-ipns-dnslink-runtime-manifest-publish` - SELF
- [DONE] `change-021-on-demand-runtime-install-policy` - SELF
- [TODO] `change-022-managed-binary-resolution-trust-order` - SELF
- [TODO] `change-023-sidecar-process-supervisor` - SELF
- [TODO] `change-024-runtime-release-matrix` - SELF

## Outputs

- Runtime manifest trust implementation in main runtime services.
- Focused runtime manifest verification tests.
- Updated KBD progress and waypoint files.

## Results

- `change-019-signed-runtime-channel-manifest` completed with signed manifest v2 metadata, Ed25519 manifest signature verification, sequence rollback protection, last-verified manifest cache, and focused tests.
- QA gate skipped because artifact-refiner input files are absent for this native KBD change.
- `change-020-ipns-dnslink-runtime-manifest-publish` completed with signed release manifest upload, IPNS publish support, DNSLink/IPNS gateway resolution, HTTPS fallback, operator documentation, and focused tests.
- QA gate skipped for `change-020` because artifact-refiner input files are absent for this native KBD change.
- `change-021-on-demand-runtime-install-policy` completed with startup download removal, lazy session install, per-runtime install dedupe, cancellation preservation, previous-version retention, UI status labels, docs, and focused tests.
- QA gate skipped for `change-021` because artifact-refiner input files are absent for this native KBD change.

EXECUTION IN PROGRESS
