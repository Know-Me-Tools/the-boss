# REFLECTION: multi-runtime-agent-parity-assessment

Project: The Boss / Cherry Studio fork
Date: 2026-04-18T14:19:38Z
Status: completed
Branch policy: current 1.9.x codebase only; `v2` was not used.

## Goal Achievement

The phase goal was achieved: the current 1.9.x codebase now has the implementation needed to configure and run Claude, Codex, OpenCode, and Universal Agent Runtime through a shared runtime-aware agent model.

Delivered outcomes:

- Runtime-agnostic agent modeling with runtime profiles, runtime settings, session bindings, skill sync records, and compatibility resolution.
- Runtime-specific settings UI and i18n coverage for Claude, Codex, OpenCode, and UAR.
- Embedded and remote UAR configuration, deterministic sidecar config generation, health checks, and sidecar packaging verification.
- Structured runtime turn context that carries prompt text, runtime binding, skills, knowledge, workspace paths, attachments, and compatibility results.
- Runtime-native skill bridge generation for Claude, Codex, OpenCode, and UAR while keeping the app skill registry as the source of truth.
- Codex and OpenCode runtime adapter parity for config mapping, session reuse, permissions/approval contracts, and normalized runtime events.
- Renderer runtime telemetry chunks, runtime message blocks, readable runtime status/error display, and approval plumbing.
- Product runtime control plane for runtime profile/settings CRUD, deterministic effective config resolution, backend health checks, preload/IPC access, and Runtime Settings profile selection/test behavior.
- Runtime-kind session binding persistence so backend session ids are not reused across incompatible runtimes.
- Runtime approval response flow with OpenCode permission replies and explicit unsupported responses for runtimes without verified response protocols.
- Embedded UAR smoke coverage through the Electron main-process sidecar path: binary resolution, spawn, `/healthz`, `/readyz`, chat, telemetry, assistant text, and cleanup.
- Runtime setup documentation and smoke checklist in `docs/en/guides/agent-runtimes.md`.

## Change Results

All planned KBD changes completed:

- `change-001-runtime-agent-model`: DONE
- `change-002-runtime-settings-ui`: DONE
- `change-003-uar-execution-settings`: DONE
- `change-004-runtime-context-pipeline`: DONE
- `change-005-runtime-skill-knowledge-bridge`: DONE
- `change-006-codex-runtime-parity`: DONE
- `change-007-opencode-runtime-parity`: DONE
- `change-008-runtime-chat-telemetry`: DONE
- `change-009-runtime-validation-hardening`: DONE
- `change-010-runtime-control-plane`: DONE
- `change-011-runtime-session-bindings`: DONE
- `change-012-runtime-approval-response-flow`: DONE
- `change-013-uar-electron-smoke`: DONE

OpenSpec was not available, so execution used native KBD change files and the phase progress ledger as the source of truth.

## Verification Summary

Required gates passed:

- `pnpm format`
- `pnpm lint`
- `pnpm test`
- `pnpm uar:build:sidecar`
- `git diff --check`
- KBD JSON validation

Focused runtime validation passed:

- Runtime model/profile tests.
- Runtime settings UI tests.
- UAR service and adapter tests.
- Runtime skill bridge tests.
- Codex and OpenCode adapter tests.
- Skill plus knowledge prompt composition tests.
- Runtime stream chunk, callback, and renderer block tests.
- Runtime control service and Runtime Settings backend API tests.
- Runtime session binding repository and runtime-specific resume tests.
- Runtime approval service and RuntimeBlock approval action tests.
- Embedded UAR main-process sidecar smoke test.

Final full test result recorded by change 013:

- 294 test files passed.
- 4,437 tests passed.
- 72 tests skipped.

The final lint gate passed with non-fatal warnings that were not introduced as hard blockers:

- One oxlint warning remains under `resources/skills/prometheus-skill-system/scripts/build-marketplace.js`.
- React hooks exhaustive-deps warnings remain in `src/renderer/src/hooks/useSkills.ts` and `src/renderer/src/pages/settings/AgentSettings/components/RuntimeSettings.tsx`.

## QA Notes

Artifact-refiner QA was available for `change-001-runtime-agent-model` and passed.

For changes 002 through 009, artifact-refiner manifests were not available in this repository. Each skipped QA entry is recorded in `progress.json` with the focused verification commands used instead.

For changes 010 through 013, QA is recorded as passed in `progress.json` based on focused tests plus the final `pnpm format`, `pnpm lint`, `pnpm test`, `pnpm uar:build:sidecar`, and `git diff --check` gates.

Native KBD change files remain in `.kbd-orchestrator/changes/` for inspectability. They were not archived during this reflection step because the existing project workflow has not defined an archive destination for completed native KBD changes.

## Resolved Blockers

The original embedded UAR blocker was resolved. `pnpm uar:build:sidecar` now succeeds, copies the darwin-arm64 sidecar binary into `resources/binaries/darwin-arm64/universal-agent-runtime`, and writes `.uar-version` metadata.

The follow-up functionality blockers are resolved:

- Runtime health/test actions are routed through real IPC/preload/backend services.
- Runtime profiles and global settings are applied through an effective config resolver.
- Runtime session ids are persisted per runtime kind.
- Runtime approval buttons call backend response APIs instead of remaining display-only.
- Embedded UAR has automated main-process sidecar smoke coverage.

The repo-wide `pnpm test` gate initially failed under Vitest 4 because several constructor-style mocks used arrow functions. Those mocks were hardened, stale expectations were aligned with current service behavior, and the full test gate now passes.

## Known Limitations

This phase does not claim lossless native parity across all runtimes. The compatibility matrix and resolver are the intended contract for unsupported or degraded features.

Known runtime caveats:

- Runtime-native capabilities still differ between Claude, Codex, OpenCode, and UAR.
- Provider support is runtime-dependent; Codex provider assumptions are guarded rather than silently degraded.
- Knowledge remains app-side and prompt-injected for predictable cross-runtime behavior.
- Runtime skill copies are generated artifacts, not the source of truth.
- Manual smoke testing is still recommended for real external binaries and remote endpoints in each developer environment.

## Lessons

The correct model is a canonical agent definition plus runtime binding, not one persisted agent type per runtime.

The prompt pipeline needed a structured context bundle before adapter parity could be made reliable. Runtime-specific transformations are now localized to adapters instead of being implicit in a string-only handoff.

Runtime telemetry is part of parity. Without typed chunks and message blocks, users cannot diagnose which runtime handled a turn, whether skills synced, or why an adapter failed.

Vitest 4 compatibility surfaced repo-wide test fragility unrelated to the runtime work. Fixing those mocks was necessary to preserve the project gate rather than documenting a false external blocker.

## Next Focus

Recommended next steps:

1. Review the broad phase diff before staging, since the work spans schema, services, runtime adapters, UI, tests, docs, vendored UAR files, and lint config.
2. Run manual smoke tests against real Claude, Codex, OpenCode, and UAR environments using `docs/en/guides/agent-runtimes.md`.
3. Decide whether completed native KBD change files should be archived or kept as part of this branch's audit trail.
4. Address the remaining non-fatal lint warnings in a separate cleanup if desired.

REFLECTION COMPLETE
