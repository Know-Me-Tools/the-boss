EXECUTION: multi-runtime-agent-parity-assessment
Project: The Boss / Cherry Studio fork
Date: 2026-04-18T17:10:00Z
Selected backend: native-tool
Dispatched to: SELF
Backend rationale: The follow-up binary-distribution plan is already decomposed into bounded native KBD changes. OpenSpec is not available in this repository, and the current change is a focused packaging/test implementation that Codex can execute directly while maintaining progress.json.
Backend entrypoint: [$kbd-execute] / active waypoint
OpenSpec available: NO
Source plan: .kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/binary-distribution-plan.md

EXECUTION SCOPE

- change-014-package-scope-size-fix: Exclude build-only vendor/orchestration artifacts from packaged Electron artifacts and add a package-content audit.
- change-015-managed-binary-core: Add a verified managed-binary installer and resolver.
- change-016-uar-managed-binary-resolution: Resolve UAR through explicit overrides, verified managed binaries, and bundled fallback.
- change-017-managed-binary-ui-and-docs: Expose managed-binary status/install/update in UI and docs.
- change-018-ipfs-transport-release-workflow: Add optional IPFS transport and release workflow after managed binaries are proven.

DISPATCH CONTRACTS

- change-014-package-scope-size-fix -> SELF
  Entry: Implement .kbd-orchestrator/changes/change-014-package-scope-size-fix/change.md
  Progress file: .kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json
  Handoff: Update status/tasks/verification in progress.json and refresh current-waypoint files.

- change-015-managed-binary-core -> SELF
  Entry: Implement .kbd-orchestrator/changes/change-015-managed-binary-core/change.md after change-014 is DONE.
  Progress file: .kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json
  Handoff: Update status/tasks/verification in progress.json and refresh current-waypoint files.

- change-016-uar-managed-binary-resolution -> SELF
  Entry: Implement .kbd-orchestrator/changes/change-016-uar-managed-binary-resolution/change.md after change-015 is DONE.
  Progress file: .kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json
  Handoff: Update status/tasks/verification in progress.json and refresh current-waypoint files.

- change-017-managed-binary-ui-and-docs -> SELF
  Entry: Implement .kbd-orchestrator/changes/change-017-managed-binary-ui-and-docs/change.md after change-016 is DONE.
  Progress file: .kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json
  Handoff: Update status/tasks/verification in progress.json and refresh current-waypoint files.

- change-018-ipfs-transport-release-workflow -> SELF
  Entry: Implement .kbd-orchestrator/changes/change-018-ipfs-transport-release-workflow/change.md after change-017 is DONE.
  Progress file: .kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json
  Handoff: Update status/tasks/verification in progress.json and refresh current-waypoint files.

APPROVAL GATES

- Do not use v2.
- Do not add Redux slices or modify IndexedDB schema.
- Do not run downloaded binaries unless manifest and hash verification pass.
- Do not make IPFS the only binary transport; HTTPS fallback is mandatory.
- Do not remove bundled UAR fallback until managed install/update reliability is proven by smoke tests.

FALLBACK CONDITIONS

- If native KBD progress cannot stay bounded or inspectable, create an OpenSpec-compatible handoff artifact and stop for explicit direction because no openspec/ directory currently exists.
- If package-size verification exposes a runtime behavior regression, block change-014 before beginning managed-binary work.

VERIFICATION REQUIREMENTS

- change-014: package audit tests, pnpm build:mac:arm64, app.asar inspection, size comparison, git diff --check.
- change-015: managed binary service tests, pnpm run typecheck:node, git diff --check.
- change-016: UAR runtime service tests, UAR embedded smoke test, pnpm run typecheck:node, git diff --check.
- change-017: renderer Runtime Settings tests, managed binary IPC/preload tests, pnpm i18n:check, pnpm run typecheck:web, git diff --check.
- change-018: managed binary transport tests, release script tests, docs review, git diff --check.

PROGRESS LEDGER

- [DONE] change-014-package-scope-size-fix - SELF
- [DONE] change-015-managed-binary-core - SELF
- [DONE] change-016-uar-managed-binary-resolution - SELF
- [DONE] change-017-managed-binary-ui-and-docs - SELF
- [DONE] change-018-ipfs-transport-release-workflow - SELF

OUTPUTS

- Packaging filters in electron-builder.yml.
- Package-content audit in scripts/verify-packaged-runtime-deps.js.
- change-014 package size evidence: app 1.4G, DMG 474M, ZIP 465M.
- KBD progress and waypoint updates.

BLOCKERS

- Superpowers bootstrap file is absent at /Users/gqadonis/.codex/superpowers/SKILL.md.

REFLECTION HANDOFF

- kbd-reflect should consume package-size before/after measurements, audit evidence, build/test results, and any decision to continue into managed-binary/IPFS changes.

EXECUTION READY
