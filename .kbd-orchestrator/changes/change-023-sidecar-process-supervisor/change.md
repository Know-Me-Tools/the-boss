# change-023-sidecar-process-supervisor

Status: TODO
Priority: P0
Assigned backend: Codex
Depends on: `change-022-managed-binary-resolution-trust-order`

## Goal

Add shared process supervision so sidecars are observable, idle-time limited, restart-limited, and controllable when CPU or memory usage runs away.

## Tasks

- [ ] Add a main-process `SidecarProcessSupervisor` with `loggerService` context.
- [ ] Track sidecar pid, runtime name, binary path/version, cwd, start time, health state, restart count, CPU sample, memory RSS, and recent stderr lines.
- [ ] Add idle shutdown and explicit stop/kill controls.
- [ ] Add start-failure backoff and max restart budget.
- [ ] Add kill escalation and process-group cleanup where supported.
- [ ] Route UAR sidecar spawning and stopping through the supervisor.
- [ ] Route OpenCode managed server spawning and stopping through the supervisor.
- [ ] Expose supervisor status through runtime health/status IPC and Runtime Settings.
- [ ] Add tests for idle shutdown, restart budget, kill escalation, orphan cleanup, and status reporting.

## Acceptance Criteria

- [ ] Runtime Settings can show running sidecars and their resource state.
- [ ] Users can stop or kill a sidecar from the app.
- [ ] Sidecars do not remain orphaned after app quit or failed startup paths.
- [ ] Runaway-process diagnostics are available in logs and runtime status.

## Verification

- `pnpm vitest run src/main/services/agents/services/runtime/__tests__/UniversalAgentRuntimeService.test.ts src/main/services/agents/services/runtime/__tests__/OpenCodeCliService.test.ts src/main/services/agents/services/runtime/__tests__/RuntimeControlService.test.ts`
- `pnpm vitest run --project renderer src/renderer/src/pages/settings/AgentSettings/components/__tests__/RuntimeSettings.test.tsx`
- `pnpm run typecheck:node`
- `pnpm run typecheck:web`
- `git diff --check`

