ASSESSMENT: multi-runtime-agent-parity-assessment
Project: The Boss / Cherry Studio fork
Date: 2026-04-17T23:36:30Z
Codebase baseline: The runtime work is integrated enough for focused unit/integration coverage and sidecar packaging, but it is not yet fully functional from a user/Electron end-to-end standpoint.
Cross-tool progress: 9 KBD changes are marked DONE in `progress.json`; no active blockers are recorded there.

## Executive Readiness Estimate

Overall readiness for "all runtimes fully functional": PARTIAL, approximately 60-65%.

The backend/runtime skeleton is much further along than the product surface. Claude remains the most complete path. Codex, OpenCode, and UAR have real adapters, config mapping, session ids, stream normalization, and focused tests, but the last mile is still missing: runtime profile application, live health/start/test APIs, runtime-specific approval response wiring, runtime-kind session binding persistence, and an Electron smoke test proving UAR starts and serves chat from inside the packaged/dev app.

UAR embedded readiness: PARTIAL, approximately 55-60%.

Evidence:

- The darwin-arm64 sidecar binary exists at `resources/binaries/darwin-arm64/universal-agent-runtime`.
- `resources/binaries/darwin-arm64/universal-agent-runtime --version` returned `universal-agent-runtime 0.1.0`.
- `.uar-version` records source commit `c7c8416b94d39358ec7cf03691738426c25b2df8`, matching `UniversalAgentRuntimeService.UAR_EXPECTED_COMMIT`.
- `UniversalAgentRuntimeService` can resolve the binary, generate config, spawn the child process, and wait for `/healthz` plus `/readyz`.
- `UarRuntimeAdapter` can resolve embedded or remote endpoints, call `/v1/models`, and post streamed chat requests to `/v1/chat/completions`.
- Focused runtime tests passed: 7 files / 21 tests.

Main caveat:

The current assessment did not launch the Electron app and run a real UAR chat through the renderer. The code supports the path, but full functional status requires an Electron smoke/E2E test that proves the renderer can select UAR, save settings, start the embedded sidecar from the app process, stream `/v1/chat/completions`, render runtime telemetry, and shut down cleanly.

## Implementation Status

- Runtime schemas and type model: PARTIAL — `AgentRuntimeKindSchema` supports `claude`, `codex`, `opencode`, and `uar`, and the agent/session config can store `configuration.runtime`. However, runtime profiles and global runtime settings exist as tables/repository methods but are not wired into main IPC/preload, the settings UI, or `resolveRuntimeConfig`.
- Database runtime tables: PARTIAL — `agent_runtime_profiles`, `agent_runtime_settings`, `agent_runtime_session_bindings`, and `agent_runtime_skill_syncs` exist. Skill sync rows are used. Runtime profile/settings tables are mostly internal foundation. Runtime session bindings are defined but runtime execution still uses the legacy `agent_session_id` field.
- Runtime settings UI: PARTIAL — The UI can edit `configuration.runtime` fields and persist them through existing agent/session update APIs. The profile input is free text, not a profile selector. The "Test connection" button only sets a local info message; it does not call main-process runtime health/start logic.
- Claude runtime: DONE — Existing Claude Agent SDK path remains the most complete runtime, including permissions, compaction, tools, skills, knowledge, session resume, and established renderer approval flow.
- Codex runtime: PARTIAL — `CodexRuntimeAdapter` imports `@openai/codex-sdk`, validates OpenAI-compatible providers, maps sandbox/approval/network/reasoning/MCP config, resumes threads, and emits normalized events. Remaining gaps are runtime profile application, full MCP mapping from canonical agent MCP selections into Codex config, explicit approval response plumbing, and real-runtime smoke coverage.
- OpenCode runtime: PARTIAL — `OpenCodeRuntimeAdapter` supports managed and remote modes, config generation, session reuse, event normalization, and permission events. Remaining gaps are live managed-server health controls, renderer approval response handling for emitted permission events, runtime profile application, and real OpenCode smoke coverage.
- UAR embedded runtime: PARTIAL — The binary is present and executable, sidecar service generates config and spawns the process, and the adapter targets `/v1/models` plus `/v1/chat/completions`. Remaining gaps are a real Electron-started sidecar smoke test, UI health/start/stop controls, runtime profile/global settings application, UAR native skill discovery verification, and runtime-kind session binding.
- UAR remote runtime: PARTIAL — The adapter enforces an endpoint and sends requests to the configured remote URL. Remaining gaps are remote health/test UI, auth validation, remote smoke coverage, and clearer user-facing errors when model/provider routing fails.
- Runtime context pipeline: PARTIAL — A structured `RuntimeContextBundle` exists and carries runtime config, compatibility, skills, knowledge, workspace paths, and images. Most non-Claude adapters still collapse the request to text for execution; attachments/files are not fully mapped into Codex/OpenCode/UAR native request surfaces.
- Skill and knowledge bridge: PARTIAL — Runtime skill files are generated for Codex, OpenCode, and UAR, and sync status is recorded. UAR skill support is file/manifest based only; there is no verified UAR API ingestion, hot reload, or sidecar discovery check. Knowledge remains app-side prompt injection, which is acceptable for parity but not native UAR knowledge integration.
- Chat telemetry: PARTIAL — Runtime stream chunks and `RuntimeBlock` render runtime status, session id, metadata, and debug payload. Approval buttons render for runtime approval events, but the buttons have no action handler wired to the runtime that requested approval.
- Documentation: DONE — `docs/en/guides/agent-runtimes.md` documents runtimes, setup, UAR sidecar build, skill bridge, chat telemetry, and smoke checklist.

## Cross-Tool Progress

- `change-001-runtime-agent-model`: DONE by Codex — runtime model, profiles/settings/session-binding/skill-sync tables, compatibility resolver.
- `change-002-runtime-settings-ui`: DONE by Codex — runtime settings panel and i18n coverage.
- `change-003-uar-execution-settings`: DONE by Codex — UAR embedded/remote execution settings and sidecar packaging path.
- `change-004-runtime-context-pipeline`: DONE by Codex — structured runtime turn bundle.
- `change-005-runtime-skill-knowledge-bridge`: DONE by Codex — runtime-native skill materialization.
- `change-006-codex-runtime-parity`: DONE by Codex — Codex adapter config mapping and stream normalization.
- `change-007-opencode-runtime-parity`: DONE by Codex — OpenCode managed/remote adapter path.
- `change-008-runtime-chat-telemetry`: DONE by Codex — runtime chunks and message block rendering.
- `change-009-runtime-validation-hardening`: DONE by Codex — docs, sidecar build, lint/test/format validation.

## Spec Gap Summary

- Runtime profiles are not product-functional yet: `RuntimeProfileRepository` exists, but the only `getRuntimeProfiles` IPC/preload path found is for artifacts, not agent runtimes.
- Runtime settings are not globally applied: `resolveRuntimeConfig` reads only `session.configuration.runtime`; it does not merge runtime profile defaults or global `agent_runtime_settings`.
- Runtime health/test is not real: the settings button does not call a main-process health endpoint, does not start UAR, and does not validate remote OpenCode/UAR endpoints.
- Runtime session binding table is unused for execution: Codex/OpenCode/UAR resume through `sessionMessages.agent_session_id`, which is not runtime-kind scoped. Switching runtimes can reuse an incompatible session id.
- Runtime approvals are not end-to-end: OpenCode emits `data-agent-runtime-permission`, and `RuntimeBlock` renders buttons, but no response action is connected to OpenCode/Codex/UAR approval APIs.
- UAR embedded has not been proven inside Electron: sidecar binary and service code exist, but there is no Electron smoke test that starts the sidecar from the app, validates `/healthz` and `/readyz`, sends chat, renders telemetry, and shuts down.
- UAR native capabilities are not fully exercised: current UAR bridge materializes `.uar/skills.json`, but no code verifies that the sidecar loads/discovers those skills or maps canonical tools/files into UAR-native tool calls.
- Non-Claude multimodal/file handling is incomplete: `RuntimeContextBundle` carries images, but Codex/OpenCode/UAR adapters primarily send text prompts.
- Capability resolver warns only: it reports incompatible capability warnings but always returns `compatible: true` with no blocking issues. That is too weak for full functional safety.

## Build Health

- focused runtime tests: PASS — `pnpm vitest run src/main/services/agents/services/runtime/__tests__/UniversalAgentRuntimeService.test.ts src/main/services/agents/services/runtime/__tests__/UarRuntimeAdapter.test.ts src/main/services/agents/services/runtime/__tests__/CodexRuntimeAdapter.test.ts src/main/services/agents/services/runtime/__tests__/OpenCodeRuntimeAdapter.test.ts src/renderer/src/pages/settings/AgentSettings/components/__tests__/RuntimeSettings.test.tsx src/renderer/src/services/messageStreaming/callbacks/__tests__/runtimeCallbacks.test.ts src/renderer/src/pages/home/Messages/Blocks/__tests__/RuntimeBlock.test.tsx`
- focused runtime test result: PASS — 7 files / 21 tests.
- UAR binary check: PASS — `resources/binaries/darwin-arm64/universal-agent-runtime --version`.
- KBD JSON check: PASS — current waypoint and progress JSON parse successfully.
- full project gates: PASS in completed `change-009` ledger — `pnpm format`, `pnpm lint`, `pnpm test`, and `pnpm uar:build:sidecar`.
- Electron UAR smoke: UNKNOWN — not run during this assessment.
- known violations: Non-fatal lint warnings remain from the prior phase ledger; not runtime blockers, but should be cleaned separately.
- test coverage: PARTIAL — adapter/config/UI unit coverage exists, but real runtime and Electron E2E coverage is still missing.

## Constraint Check

- AGENTS.md violations: NONE observed in assessed runtime code. Logging uses `loggerService`; no new Redux slice or IndexedDB schema change was found for this runtime path.
- constraints.md violations: N/A — no `.kbd-orchestrator/constraints.md` was loaded during this assessment.
- branch policy: PASS — assessment stayed on the current 1.9.x/main codebase and did not use `v2`.
- sycophancy review: MANUAL — no callable `detect_sycophancy` tool was exposed. Manual self-check found material gaps and does not claim lossless runtime parity.

## Goal Progress

- Configure each runtime from the app: PARTIAL — agent/session runtime config can be persisted, but runtime profiles/global settings and real health/test actions are missing.
- Run Claude runtime: MET — existing path is mature relative to the new runtimes.
- Run Codex runtime: PARTIAL — adapter is real and tested with mocks; needs real SDK smoke and approval/tool edge-case validation.
- Run OpenCode runtime: PARTIAL — adapter is real and tested with mocks; needs managed/remote smoke and approval response completion.
- Run UAR embedded from Electron: PARTIAL — sidecar binary exists, service can spawn/wait for health in tests, adapter calls UAR endpoints, but Electron app smoke/E2E has not proved the full user path.
- Run UAR remote: PARTIAL — request path exists; needs health/test UI and remote smoke.
- Runtime skills and knowledge: PARTIAL — prompt-side knowledge works and files are materialized; UAR native skill discovery is not verified.
- Runtime telemetry: PARTIAL — status blocks render, but runtime approvals are display-only.

## What It Takes To Reach Full Functionality

### P0: Prove And Wire UAR Inside Electron

1. Add main-process IPC for runtime health:
   - `agent-runtime:list-profiles`
   - `agent-runtime:upsert-profile`
   - `agent-runtime:get-settings`
   - `agent-runtime:upsert-settings`
   - `agent-runtime:test-connection`
   - `agent-runtime:start-sidecar`
   - `agent-runtime:stop-sidecar`
   - `agent-runtime:get-status`
2. Expose those APIs through preload and typed renderer wrappers.
3. Make `RuntimeSettings` call the health/test IPC instead of setting a local message.
4. Add explicit UAR sidecar status states: missing binary, starting, healthy, not ready, crashed, port conflict, remote unreachable.
5. Add an Electron smoke test that:
   - selects runtime `uar`, mode `embedded`;
   - saves settings;
   - starts the sidecar from Electron main;
   - verifies `/healthz` and `/readyz`;
   - sends a chat request through the normal agent session flow;
   - verifies runtime telemetry and assistant text render;
   - verifies shutdown on app quit or explicit stop.

### P0: Fix Runtime Session Binding

1. Persist runtime session ids in `agent_runtime_session_bindings` by `(session_id, runtime_kind)`.
2. Stop using one shared `sessionMessages.agent_session_id` as the only resume source for all runtimes.
3. Save and load Codex thread ids, OpenCode session ids, Claude session ids, and UAR session ids through the runtime binding table.
4. Add regression tests for switching a session between runtimes without reusing an incompatible runtime id.

### P0: Complete Runtime Approval Response Flow

1. Add a runtime approval request/response bridge in main process.
2. Wire `RuntimeBlock` buttons to a typed approval response handler.
3. Implement OpenCode permission response calls against the OpenCode SDK/client.
4. Confirm whether Codex SDK approval events require an explicit response API; if so, implement it.
5. Keep UAR approval capability disabled until UAR exposes a supported approval protocol.

### P1: Make Runtime Profiles Real

1. Wire `RuntimeProfileRepository` through IPC/preload.
2. Replace the free-text profile id input with a runtime profile selector.
3. Merge config in this order: global runtime settings -> selected runtime profile -> agent config -> session override.
4. Show effective config and compatibility warnings before execution.
5. Add tests for profile/default/global merging.

### P1: Verify UAR Native Skill And Tool Discovery

1. After materializing `.uar/skills.json`, call a UAR discovery endpoint or add a sidecar-side file watcher/discovery check.
2. Surface UAR skill sync status in settings and runtime telemetry.
3. Map canonical allowed tools/MCP/native tools into UAR-specific config or request fields.
4. Add smoke coverage proving a selected app skill is visible to UAR during a real embedded run.

### P1: Broaden Real Runtime Smoke Coverage

1. Codex managed: real OpenAI-compatible model, sandbox, network policy, tool event, resume.
2. OpenCode managed: two-turn session, managed server reuse, permission event, shutdown.
3. OpenCode remote: endpoint/auth/config update.
4. UAR remote: endpoint/auth, `/v1/models`, streamed chat.
5. Claude regression: existing tool approval, skill, knowledge, compaction.

### P2: Tighten Capability Safety

1. Let the compatibility resolver produce blocking issues for unsafe combinations.
2. Block or require confirmation for runtime settings that cannot be honored.
3. Add visible warnings when non-Claude runtimes do not support compaction, native approvals, multimodal inputs, or native knowledge.

## Distance Summary

The project is past the architecture/prototype phase. The remaining work is not a rewrite; it is the operational last mile:

- 2-3 P0 implementation slices for health IPC/UAR Electron smoke, runtime session bindings, and approval responses.
- 1-2 P1 slices for profile merging and UAR native skill/tool verification.
- A runtime smoke suite that runs real binaries/endpoints rather than only mocked adapters.

Until those are complete, the honest status is: runtime adapters are implemented and unit-tested; all runtimes are not yet fully functional for end users, and embedded UAR is not yet proven as fully running inside Electron.

ASSESSMENT COMPLETE
