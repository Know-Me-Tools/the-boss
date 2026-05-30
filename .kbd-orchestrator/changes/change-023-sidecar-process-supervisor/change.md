# change-023-sidecar-process-supervisor

Status: DONE
Priority: P0
Assigned backend: claude-code (subagent-driven TDD)
Depends on: `change-022-managed-binary-resolution-trust-order`

## Goal

Add shared process supervision so sidecars are observable, idle-time limited, restart-limited, and controllable when CPU or memory usage runs away.

## Tasks

- [x] Add a main-process `SidecarProcessSupervisor` with `loggerService` context.
- [x] Track sidecar pid, runtime name, binary path/version, cwd, start time, health state, restart count, CPU sample, memory RSS, and recent stderr lines.
- [x] Add idle shutdown and explicit stop/kill controls.
- [x] Add start-failure backoff and max restart budget.
- [x] Add kill escalation and process-group cleanup where supported. (tree-kill for process-group teardown; detached:true spawns.)
- [x] Route UAR sidecar spawning and stopping through the supervisor.
- [x] Route OpenCode managed server spawning and stopping through the supervisor.
- [x] Expose supervisor status through runtime health/status IPC and Runtime Settings.
- [x] Add tests for idle shutdown, restart budget, kill escalation, orphan cleanup, and status reporting.

## Outcome

- New `SidecarProcessSupervisor` (singleton) owns all sidecar child lifecycle: detached process groups, `pidusage` CPU/RSS sampling (observe + report only, default thresholds CPU 90% / RSS 2GB), idle shutdown (15m), restart budget (3 / 60s with 1-2-4s backoff → `failed`), kill escalation (SIGTERM → 3s → SIGKILL via `tree-kill`), and `shutdownAll()` for app-quit.
- UAR and OpenCode route spawn/stop through the supervisor; both dropped their self-registered `before-quit` handlers; `src/main/index.ts` `will-quit` calls `shutdownAll()`.
- New deps: `pidusage`, `tree-kill` (+ `@types/pidusage`).
- IPC: `AgentRuntime_GetSupervisorStatus` / `AgentRuntime_StopSupervisedSidecar` / `AgentRuntime_KillSidecar`; `SupervisedSidecarStatus` lives in `@shared/agents/runtime`.
- Runtime Settings shows a "Running sidecars" panel (name, state Tag, pid, cpu%, RSS, restarts, uptime) with Stop + Kill (Popconfirm) controls, polling on a 4s visible-only interval.
- Design + plan docs: `docs/plans/2026-05-29-sidecar-process-supervisor*.md`.

## Verification (all green)

- `pnpm vitest run` on UAR, OpenCode, RuntimeControlService, SidecarProcessSupervisor → 70 tests pass.
- `pnpm vitest run --project renderer RuntimeSettings.test.tsx` → 25 pass.
- Full runtime dir → 17 files / 130 tests pass.
- `pnpm typecheck` (node + web + aiCore) → all exit 0.
- `pnpm i18n:check` → passed. `git diff --check` → clean.

Built subagent-driven TDD: each task went implementer → spec-review → code-quality-review → fix. Reviews caught ~10 real async/integration bugs (post-exit sampling race, concurrent-stop timer leak, pidless-entry stranding, stop-during-restart, UAR stale-status/double-spawn races, OpenCode restart-eviction race, UI unmount races) before merge.

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

