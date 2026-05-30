# SidecarProcessSupervisor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a shared main-process `SidecarProcessSupervisor` that supervises UAR and OpenCode sidecar child processes — resource sampling, idle shutdown, restart budget/backoff, kill escalation, process-group/orphan cleanup, and status reporting through IPC and Runtime Settings.

**Architecture:** A singleton supervisor owns every sidecar `ChildProcess`. Callers pass a spawn thunk and get a managed handle; the supervisor adds `detached` process groups, periodic `pidusage` sampling, an idle timer, a restart budget, and `tree-kill`-based termination. It is the single owner of app-quit cleanup. `RuntimeControlService` exposes `getSupervisorStatus()` over a new IPC channel; `RuntimeSettings.tsx` lists running sidecars with Stop/Kill controls.

**Tech Stack:** TypeScript (Electron main), Vitest, `pidusage`, `tree-kill`, Ant Design + React (renderer). Node ≥24.11 (use `~/.nvm/versions/node/v24.16.0/bin` on PATH for pnpm).

**Design doc:** `docs/plans/2026-05-29-sidecar-process-supervisor-design.md`

**Conventions:** Run all pnpm/git via Node 24: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`. Commit with `--signoff`. Branch: `change/023-sidecar-process-supervisor`. Never use `v2`.

---

## Task 1: Supervisor skeleton + types + status reporting

**Files:**
- Create: `src/main/services/agents/services/runtime/SidecarProcessSupervisor.ts`
- Create: `src/main/services/agents/services/runtime/__tests__/SidecarProcessSupervisor.test.ts`

**Step 1: Write failing tests** for: (a) `spawn()` registers a handle that `list()` returns with `state: 'running'`, pid, name, binaryPath, startedAt, restartCount 0; (b) stderr ring buffer captures last N lines; (c) `get(id)` returns the status. Use a `createMockChildProcess()` helper modeled on `UniversalAgentRuntimeService.test.ts:344` (EventEmitter + `.stdout/.stderr` PassThrough + `.kill` vi.fn that emits `exit`). Inject `pidusage` and `treeKill` as constructor deps (both `vi.fn()`).

**Step 2:** Run `pnpm vitest run src/main/services/agents/services/runtime/__tests__/SidecarProcessSupervisor.test.ts` → expect FAIL (module/class missing).

**Step 3: Implement** the class with `SupervisedSpawnSpec`, `SupervisedSidecarStatus`, `SupervisedHandle` (per design doc API), the named constants, a `Map<string, internal handle>`, id generation (`${name}:${key ?? 'default'}` or counter), stderr ring buffer (`STDERR_RING_SIZE`), `loggerService.withContext('SidecarProcessSupervisor')`, `spawn()`, `list()`, `get()`. Wire `child.stderr.on('data')` into the ring buffer and `child.once('exit')` to mark stopped + call `onExit`.

**Step 4:** Run tests → PASS.

**Step 5: Commit** `feat(runtime): add SidecarProcessSupervisor skeleton + status (change-023)`.

---

## Task 2: Resource sampling (pidusage, observe-only)

**Files:** Modify supervisor + test.

**Step 1: Failing test:** after `spawn()`, advance fake timers by `RESOURCE_SAMPLE_MS`; assert injected `pidusage` was called with the pid and that `list()[0].cpuPercent`/`rssBytes` reflect the mock sample. Add a test that a sample above `CPU_WARN_PERCENT`/`RSS_WARN_BYTES` logs a warning (spy on logger) but does NOT kill (process still `running`). Add a test that a `pidusage` rejection is swallowed (no throw, handle unchanged).

**Step 2:** Run → FAIL.

**Step 3: Implement** a periodic sampler (`setInterval(RESOURCE_SAMPLE_MS)`), store `cpuPercent`/`rssBytes`, warn on threshold breach, swallow errors. Clear interval on exit/stop.

**Step 4:** Run → PASS.

**Step 5: Commit** `feat(runtime): supervisor cpu/rss sampling with warn thresholds`.

---

## Task 3: Graceful stop + kill escalation + tree-kill

**Files:** Modify supervisor + test.

**Step 1: Failing tests:** (a) `stop(id)` calls `treeKill(pid, 'SIGTERM')`; if the process emits `exit` before `KILL_ESCALATION_MS`, no SIGKILL; (b) if it does NOT exit, after `KILL_ESCALATION_MS` (fake timers) `treeKill(pid, 'SIGKILL')` is called; (c) `kill(id)` calls `treeKill(pid, 'SIGKILL')` immediately; (d) stop/kill on an already-exited handle is a no-op; state becomes `stopped`.

**Step 2:** Run → FAIL.

**Step 3: Implement** `stop()`/`kill()` using injected `treeKill`, the SIGTERM→3s→SIGKILL escalation, idempotency, and `state` transitions (`stopping`→`stopped`).

**Step 4:** Run → PASS.

**Step 5: Commit** `feat(runtime): supervisor graceful stop + kill escalation via tree-kill`.

---

## Task 4: Idle shutdown + restart budget/backoff

**Files:** Modify supervisor + test.

**Step 1: Failing tests:** (a) `markIdle(id)` then advancing `IDLE_SHUTDOWN_MS` triggers `stop(id)`; `markActive(id)` cancels/resets the idle timer; (b) when a managed process exits unexpectedly (not via stop/kill), the supervisor restarts it via the spawn thunk after the backoff delay, incrementing `restartCount`; (c) exceeding `RESTART_BUDGET` within `RESTART_WINDOW_MS` sets `state: 'failed'` with a terminal message and does NOT respawn; (d) backoff sequence `[1000,2000,4000]` is applied between restarts.

**Step 2:** Run → FAIL.

**Step 3: Implement** idle timer (`markActive`/`markIdle`), unexpected-exit detection (distinguish supervisor-initiated stop from crash), restart with backoff, sliding restart-count window, terminal `failed` state.

**Step 4:** Run → PASS.

**Step 5: Commit** `feat(runtime): supervisor idle shutdown + restart budget/backoff`.

---

## Task 5: shutdownAll + detached process group on spawn

**Files:** Modify supervisor + test.

**Step 1: Failing tests:** (a) `shutdownAll()` stops every tracked handle (treeKill called per pid) and clears the map; (b) the spawn thunk is invoked such that the child is in its own group — assert the supervisor sets up group cleanup (since the thunk owns `spawn`, verify the supervisor calls `treeKill` on the pid, which covers the group on POSIX/Windows). Document that `detached: true` is set by the CALLER's spawn thunk (UAR/OpenCode) — supervisor relies on tree-kill for group teardown.

**Step 2:** Run → FAIL.

**Step 3: Implement** `shutdownAll()` (Promise.allSettled over `stop()`), clear timers/intervals.

**Step 4:** Run → PASS.

**Step 5: Commit** `feat(runtime): supervisor shutdownAll for app-quit cleanup`.

---

## Task 6: Route UAR through the supervisor

**Files:**
- Modify: `src/main/services/agents/services/runtime/UniversalAgentRuntimeService.ts` (constructor `:107`; `start()` spawn `:278`; `stop()` `:214`; exit handler `:302`)
- Modify: `__tests__/UniversalAgentRuntimeService.test.ts`

**Step 1: Failing/updated tests:** keep existing resolution tests; update lifecycle tests so spawning goes through an injected supervisor (add `supervisor` to `UniversalAgentRuntimeServiceDependencies`, default to the singleton). Assert the supervisor's `spawn` is called with `detached: true` in the thunk's spawn options and that `stop()` delegates to `supervisor.stop(id)`.

**Step 2:** Run → FAIL.

**Step 3: Implement:** inject `supervisor`; in `start()`, pass a spawn thunk (`() => spawn(binaryPath, args, { ...opts, detached: true })`) to `supervisor.spawn(...)`, keep `waitForUarReady` on the returned handle's `process`; replace `stop()` body with `supervisor.stop(id)`; remove the self-registered `before-quit` (Task 8 centralizes it); keep `RunningSidecar` but store the supervisor `id`.

**Step 4:** Run UAR tests → PASS.

**Step 5: Commit** `feat(runtime): route UAR sidecar through SidecarProcessSupervisor`.

---

## Task 7: Route OpenCode managed server through the supervisor

**Files:**
- Modify: `src/main/services/agents/services/runtime/OpenCodeCliService.ts` (constructor `:93`; `startManagedServer` spawn `:267`; `dispose()` `:225`; `stopProcess` `:643`)
- Modify: `__tests__/OpenCodeCliService.test.ts`

**Step 1: Updated tests:** inject `supervisor`; assert managed server spawn routes through `supervisor.spawn` with `detached: true`, readiness still works via the handle's stdout, and `dispose()` delegates to `supervisor.stop()` per server. Keep existing resolution/model tests.

**Step 2:** Run → FAIL.

**Step 3: Implement:** inject `supervisor`; wrap the `this.spawnProcess(...)` call in a thunk passed to `supervisor.spawn`, keyed per `cwd+config`; `waitForOpenCodeServerUrl` reads the handle's stdout; `dispose()` calls `supervisor.stop(id)` for each; drop the self-registered `before-quit`.

**Step 4:** Run OpenCode tests → PASS.

**Step 5: Commit** `feat(runtime): route OpenCode managed server through SidecarProcessSupervisor`.

---

## Task 8: Centralized app-quit cleanup

**Files:**
- Modify: `src/main/index.ts` `will-quit` handler (`:294`)
- Modify: supervisor (export singleton `sidecarProcessSupervisor`)

**Step 1:** Add `sidecarProcessSupervisor.shutdownAll()` to `will-quit` (with the other service shutdowns). Confirm UAR/OpenCode no longer self-register `before-quit` (done in Tasks 6–7).

**Step 2:** `pnpm run typecheck:node` → PASS.

**Step 3: Commit** `feat(runtime): centralize sidecar shutdown on app will-quit`.

---

## Task 9: Status IPC + RuntimeControlService

**Files:**
- Modify: `packages/shared/IpcChannel.ts` (add `AgentRuntime_GetSupervisorStatus`, `AgentRuntime_KillSidecar`)
- Modify: `src/main/services/agents/services/runtime/RuntimeControlService.ts` (add `getSupervisorStatus()`, `killSidecar(id)`)
- Modify: `src/main/ipc.ts` (handlers)
- Modify: `src/preload/index.ts` (`window.api.agentRuntime.getSupervisorStatus` / `killSidecar`)
- Modify: `__tests__/RuntimeControlService.test.ts`

**Step 1: Failing test:** `RuntimeControlService.getSupervisorStatus()` returns the injected supervisor's `list()`; `killSidecar(id)` delegates to `supervisor.kill(id)`.

**Step 2:** Run → FAIL.

**Step 3: Implement** the methods, IPC channel constants, main handlers, and preload wrappers (mirror existing `stopSidecar` wiring).

**Step 4:** Run RuntimeControlService tests + `typecheck:node` → PASS.

**Step 5: Commit** `feat(runtime): expose supervisor status + killSidecar over IPC`.

---

## Task 10: Runtime Settings UI — running sidecars + Stop/Kill

**Files:**
- Modify: `src/renderer/src/pages/settings/AgentSettings/components/RuntimeSettings.tsx` (Managed-binary block `:931`)
- Modify: `src/renderer/src/i18n/locales/en-us.json` (+ run `pnpm i18n:sync`)
- Modify: `__tests__/RuntimeSettings.test.tsx`

**Step 1: Failing test:** rendering with a mocked `getSupervisorStatus` returning one running sidecar shows its name/pid/cpu/rss/restartCount and a Stop + Kill button; clicking Stop calls `stopSidecar`, Kill calls `killSidecar`.

**Step 2:** Run `pnpm vitest run --project renderer .../RuntimeSettings.test.tsx` → FAIL.

**Step 3: Implement** a "Running sidecars" sub-block: fetch `getSupervisorStatus` on mount + light interval while panel open; render rows; wire buttons. Add i18n keys under `agent.settings.runtime.supervisor.*`; run `pnpm i18n:sync`.

**Step 4:** Run renderer test + `typecheck:web` → PASS.

**Step 5: Commit** `feat(runtime): show running sidecars with stop/kill in Runtime Settings`.

---

## Task 11: Full verification + change/progress bookkeeping

**Step 1:** Run the change-023 spec verification:
```
pnpm vitest run src/main/services/agents/services/runtime/__tests__/UniversalAgentRuntimeService.test.ts src/main/services/agents/services/runtime/__tests__/OpenCodeCliService.test.ts src/main/services/agents/services/runtime/__tests__/RuntimeControlService.test.ts src/main/services/agents/services/runtime/__tests__/SidecarProcessSupervisor.test.ts
pnpm vitest run --project renderer src/renderer/src/pages/settings/AgentSettings/components/__tests__/RuntimeSettings.test.tsx
pnpm run typecheck:node && pnpm run typecheck:web
git diff --check
```
Expected: all green, diff clean.

**Step 2:** Mark all 9 tasks `[x]` in `.kbd-orchestrator/changes/change-023-sidecar-process-supervisor/change.md` (Status: DONE) and update `.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json` (change-023 DONE, next_pending_change `change-024-runtime-release-matrix`).

**Step 3: Commit** `chore(kbd): mark change-023 complete`.

**Step 4:** Push branch; open PR `change/023 → main` via `gh-create-pr`.
