# Current KBD Waypoint

Project: The Boss / Cherry Studio fork
Phase: multi-runtime-agent-parity-assessment
Date: 2026-04-17
Status: execution_complete

## Current Position

KBD execution and reflection are complete for the original runtime parity scope in `multi-runtime-agent-parity-assessment`.

A follow-up KBD assessment and plan now cover binary distribution and package-size reduction after the mac arm64 build showed the compiled application had grown to roughly 5 GB.

Phase state:

- `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/assessment.md`
- `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/plan.md`
- `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/execution.md`
- `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/reflection.md`
- `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json`
- `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/binary-distribution-assessment.md`
- `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/binary-distribution-plan.md`

## Planned Change Units

1. `change-001-runtime-agent-model`
2. `change-002-runtime-settings-ui`
3. `change-003-uar-execution-settings`
4. `change-004-runtime-context-pipeline`
5. `change-005-runtime-skill-knowledge-bridge`
6. `change-006-codex-runtime-parity`
7. `change-007-opencode-runtime-parity`
8. `change-008-runtime-chat-telemetry`
9. `change-009-runtime-validation-hardening`

## Completed Changes

- `change-001-runtime-agent-model`
- `change-002-runtime-settings-ui`
- `change-003-uar-execution-settings`
- `change-004-runtime-context-pipeline`
- `change-005-runtime-skill-knowledge-bridge`
- `change-006-codex-runtime-parity`
- `change-007-opencode-runtime-parity`
- `change-008-runtime-chat-telemetry`
- `change-009-runtime-validation-hardening`

Runtime-specific validation passed, including targeted runtime tests and UAR sidecar packaging. The required full `pnpm test` gate and final `pnpm lint` gate also pass.

A follow-up KBD assessment found that the runtime implementation was still PARTIAL for full end-user functionality. The main gaps were runtime health IPC, embedded UAR Electron smoke coverage, runtime-kind session bindings, runtime approval responses, and real runtime profile application.

A follow-up KBD plan narrowed execution to four remaining changes, now completed:

1. `change-010-runtime-control-plane`
2. `change-011-runtime-session-bindings`
3. `change-012-runtime-approval-response-flow`
4. `change-013-uar-electron-smoke`

Final verification passed:

- `pnpm format`
- `pnpm lint`
- `pnpm test`
- `pnpm uar:build:sidecar`

## Binary Distribution Follow-Up

Assessment conclusion: the immediate 5 GB package regression is primarily caused by build-only vendor material entering packaged artifacts, especially `vendor/universal-agent-runtime` and Rust `target` output. The UAR executable itself is much smaller than the vendored checkout.

New planned native KBD changes:

1. `change-014-package-scope-size-fix` - DONE
2. `change-015-managed-binary-core` - DONE
3. `change-016-uar-managed-binary-resolution` - DONE
4. `change-017-managed-binary-ui-and-docs` - DONE
5. `change-018-ipfs-transport-release-workflow` - DONE

`change-014-package-scope-size-fix` completed with packaged artifact size reduced from the previous 5.0 GB app baseline to a 1.4 GB app, 474 MB DMG, and 465 MB ZIP. The packaged app audit confirms no top-level `vendor`, `.kbd-orchestrator`, `.refiner`, `dist`, or `target` content in `app.asar`, and UAR/RTK bundled fallback binaries remain executable under `app.asar.unpacked/resources/binaries/darwin-arm64`.

`change-015-managed-binary-core` completed with a shared managed-binary service for deterministic app-data installs, manifest-based size/SHA-256 verification, temp-file atomic install, Unix chmod, and file/HTTPS transports. Focused tests cover local file install, hash/size mismatch rejection, unsupported platform reporting, and update-available status.

`change-016-uar-managed-binary-resolution` completed with UAR binary resolution through explicit config, `UAR_SIDECAR_PATH`, verified managed app-data binary, and bundled fallback. UAR status now reports binary source and managed-binary failure states, and verification failures block fallback execution.

`change-017-managed-binary-ui-and-docs` completed with runtime settings status display for managed UAR binaries, backend install/update IPC, renderer tests for status states, and docs for offline fallback/update behavior.

`change-018-ipfs-transport-release-workflow` completed with optional IPFS gateway transport, HTTPS/file fallback, max-size enforcement, release manifest generation, transport tests, and docs. The bundled UAR fallback remains in production packaging until managed install/update reliability is proven by smoke tests.

## Next Action

Run `kbd-reflect` for the completed phase. Do not use `v2`.
