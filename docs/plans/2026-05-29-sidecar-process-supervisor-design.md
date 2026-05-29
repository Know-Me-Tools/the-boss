# SidecarProcessSupervisor — Design (change-023)

**Date:** 2026-05-29
**Phase:** multi-runtime-agent-parity-assessment
**Change:** change-023-sidecar-process-supervisor
**Depends on:** change-022-managed-binary-resolution-trust-order

## Goal

Add shared process supervision so runtime sidecars (UAR embedded sidecar,
OpenCode managed server) are observable, idle-time limited, restart-limited, and
controllable when CPU or memory usage runs away. Eliminate orphaned processes on
app quit and failed-startup paths.

## Decisions (approved)

| Topic | Decision |
|---|---|
| Resource metrics | Add `pidusage` (CPU/RSS sampling) |
| Process-group / orphan kill | Add `tree-kill`; spawn with `detached: true` for a process group |
| Idle shutdown | 15 min with no active session |
| Restart budget | max 3 restarts / 60s window, backoff 1s→2s→4s, then give up with a clear error |
| Kill escalation | SIGTERM → 3s → SIGKILL (matches existing UAR pattern) |
| Runaway CPU/mem | **Observe + report only** — log warnings + expose metrics; never auto-kill |
| Status IPC | New `AgentRuntime_GetSupervisorStatus` channel (separate from `getStatus`) |

## Architecture

A singleton `SidecarProcessSupervisor`
(`src/main/services/agents/services/runtime/SidecarProcessSupervisor.ts`) owns the
lifecycle of every runtime sidecar child process. UAR and OpenCode stop calling
`spawn`/`kill` directly; they hand the supervisor a *spawn thunk* and receive a
managed handle. The supervisor is the single owner of app-quit cleanup.

```
UniversalAgentRuntimeService ─┐
                              ├─> SidecarProcessSupervisor ──> ChildProcess (detached group)
OpenCodeCliService ───────────┘         │
                                        ├─ pidusage (periodic CPU/RSS sample)
                                        ├─ tree-kill (group/orphan termination)
                                        └─ idle timer + restart budget + kill escalation
RuntimeControlService.getSupervisorStatus() ──IPC──> RuntimeSettings.tsx (list + Stop/Kill)
```

### Why a spawn thunk (not args)

The supervisor owns process *management*, not *configuration*. Each runtime keeps
its own env/args/cwd/readiness logic and passes `spawn: () => ChildProcess`. This
avoids leaking UAR/OpenCode-specific spawn details into the supervisor and keeps
readiness detection where it belongs.

## Core API

```ts
interface SupervisedSpawnSpec {
  name: string                 // runtime name, e.g. 'universal-agent-runtime' | 'opencode'
  key?: string                 // optional sub-key (OpenCode keys per cwd+config)
  spawn: () => ChildProcess    // caller-owned spawn; supervisor adds detached + tracking
  binaryPath: string
  binaryVersion?: string
  cwd?: string
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

interface SupervisedSidecarStatus {
  id: string
  name: string
  key?: string
  pid?: number
  binaryPath: string
  binaryVersion?: string
  cwd?: string
  startedAt: number
  state: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'
  restartCount: number
  cpuPercent?: number
  rssBytes?: number
  recentStderr: string[]       // ring buffer, last N lines
}

class SidecarProcessSupervisor {
  spawn(spec: SupervisedSpawnSpec): SupervisedHandle
  stop(id: string): Promise<void>          // graceful: SIGTERM → 3s → SIGKILL via tree-kill
  kill(id: string): Promise<void>          // immediate SIGKILL via tree-kill
  markActive(id: string): void             // resets idle timer
  markIdle(id: string): void               // arms idle-shutdown timer
  list(): SupervisedSidecarStatus[]
  get(id: string): SupervisedSidecarStatus | undefined
  shutdownAll(): Promise<void>             // app-quit cleanup
}
```

`SupervisedHandle` exposes `{ id, process, status() }` so callers retain the
`ChildProcess` for readiness detection and stdout/stderr wiring.

## Constants (named, overridable later)

```ts
const IDLE_SHUTDOWN_MS = 15 * 60_000
const RESTART_BUDGET = 3
const RESTART_WINDOW_MS = 60_000
const RESTART_BACKOFF_MS = [1_000, 2_000, 4_000]
const KILL_ESCALATION_MS = 3_000
const RESOURCE_SAMPLE_MS = 5_000
const STDERR_RING_SIZE = 50
const CPU_WARN_PERCENT = 90
const RSS_WARN_BYTES = 2 * 1024 * 1024 * 1024
```

## Data flow / status

- `RuntimeControlService.getSupervisorStatus(): SupervisedSidecarStatus[]`
  returns `supervisor.list()`.
- New IPC `AgentRuntime_GetSupervisorStatus` (and `AgentRuntime_KillSidecar`)
  added to `packages/shared/IpcChannel.ts`, preload `window.api.agentRuntime`,
  and main `ipc.ts`. Existing `stopSidecar` is reused for graceful stop.
- `RuntimeHealthResult` is NOT widened with resource fields (avoids churning the
  15-state health union); supervisor status is a separate payload.

## UI

`RuntimeSettings.tsx` gains a "Running sidecars" block under the Managed-binary
section: a list of `SupervisedSidecarStatus` rows (name, pid, cpu%, RSS, restart
count, uptime) each with **Stop** and **Kill** buttons wired to
`window.api.agentRuntime.stopSidecar()` / `killSidecar(id)`. Refreshes on a light
interval while the settings panel is open. New i18n keys under
`agent.settings.runtime.supervisor.*`.

## Error handling

- Spawn failure → record failure, apply backoff, restart within budget.
- Restart budget exhausted → `state: 'failed'` with terminal message, logged via
  `loggerService.withContext('SidecarProcessSupervisor')`.
- `stop`/`kill` are idempotent; killing an already-exited process is a no-op.
- `pidusage` errors (process gone) are swallowed; the handle is marked exited.
- App quit: `src/main/index.ts` `will-quit` calls `supervisor.shutdownAll()`;
  UAR/OpenCode drop their own `before-quit` self-registration.

## Testing

New `__tests__/SidecarProcessSupervisor.test.ts`:
- idle shutdown (fake timers → stop after IDLE_SHUTDOWN_MS idle)
- restart budget exhaustion (4th failure within window → `failed`)
- backoff sequence applied between restarts
- kill escalation (SIGTERM, then SIGKILL after 3s if not exited)
- orphan/group cleanup (tree-kill invoked with pid; injected mock)
- status reporting (pid, cpu, rss, restartCount, recentStderr ring)

`pidusage` and `tree-kill` are injected as constructor deps for mockability.
Existing UAR/OpenCode/RuntimeControlService tests updated to route through the
supervisor (reuse `spawnMock`/`createChildProcess` and injectable `spawnProcess`).

Verification (from change spec):
- `pnpm vitest run` on UAR, OpenCode, RuntimeControlService, SidecarProcessSupervisor tests
- `pnpm vitest run --project renderer` RuntimeSettings.test.tsx
- `pnpm run typecheck:node` / `typecheck:web`
- `git diff --check`

## Out of scope

- Auto-kill on runaway resource thresholds (observe + report only).
- Codex (it is SDK/exec-driven, not a long-lived sidecar server in scope here).
- Widening `RuntimeHealthResult` with resource fields.
