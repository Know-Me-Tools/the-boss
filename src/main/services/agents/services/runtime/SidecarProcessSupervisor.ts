import type { ChildProcess } from 'node:child_process'

import { loggerService } from '@logger'
import pidusage from 'pidusage'
import treeKill from 'tree-kill'

const logger = loggerService.withContext('SidecarProcessSupervisor')

/**
 * Maximum number of recent stderr lines retained per supervised sidecar.
 */
export const STDERR_RING_SIZE = 50

/**
 * Interval (ms) between CPU/RSS resource samples for each supervised sidecar.
 */
export const RESOURCE_SAMPLE_MS = 5000

/**
 * CPU usage percentage at or above which a warning is logged (observe-only).
 */
export const CPU_WARN_PERCENT = 90

/**
 * Resident set size in bytes at or above which a warning is logged (observe-only).
 */
export const RSS_WARN_BYTES = 2 * 1024 * 1024 * 1024

/**
 * Grace period (ms) after SIGTERM before escalating a graceful stop to SIGKILL.
 */
export const KILL_ESCALATION_MS = 3000

/**
 * Idle period (ms) after which an idle-marked sidecar is gracefully stopped.
 */
export const IDLE_SHUTDOWN_MS = 15 * 60_000

/**
 * Maximum number of automatic restarts permitted within {@link RESTART_WINDOW_MS}.
 */
export const RESTART_BUDGET = 3

/**
 * Sliding window (ms) over which restarts are counted against {@link RESTART_BUDGET}.
 */
export const RESTART_WINDOW_MS = 60_000

/**
 * Backoff delays (ms) applied before successive restart attempts. The Nth
 * restart waits `RESTART_BACKOFF_MS[min(N, len - 1)]`.
 */
export const RESTART_BACKOFF_MS = [1000, 2000, 4000]

type SupervisedState = 'starting' | 'running' | 'restarting' | 'stopping' | 'stopped' | 'failed'

export interface SupervisedSpawnSpec {
  name: string
  key?: string
  spawn: () => ChildProcess
  binaryPath: string
  binaryVersion?: string
  cwd?: string
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

export interface SupervisedSidecarStatus {
  id: string
  name: string
  key?: string
  pid?: number
  binaryPath: string
  binaryVersion?: string
  cwd?: string
  startedAt: number
  state: SupervisedState
  restartCount: number
  cpuPercent?: number
  rssBytes?: number
  recentStderr: string[]
}

export interface SupervisedHandle {
  id: string
  process: ChildProcess
  status(): SupervisedSidecarStatus
}

/**
 * Resource sample returned by pidusage for a single pid. Only the fields the
 * supervisor consumes are required, so injected fakes stay lightweight.
 */
export interface ResourceSample {
  cpu: number
  memory: number
}

/**
 * Narrow contract for the single-pid pidusage call the supervisor relies on.
 * Avoids coupling to the full `typeof pidusage` (which carries a `.clear`
 * namespace member) so tests can inject a plain mock.
 */
export type PidusageSampler = (pid: number) => Promise<ResourceSample>

type TreeKill = typeof treeKill

export interface SidecarProcessSupervisorDeps {
  pidusage?: PidusageSampler
  treeKill?: TreeKill
}

interface SupervisedEntry {
  id: string
  name: string
  key?: string
  process: ChildProcess
  /** Thunk that spawns a fresh child; reused to restart after a crash. */
  spawn: () => ChildProcess
  /** Caller-supplied exit observer, invoked on every child exit. */
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
  binaryPath: string
  binaryVersion?: string
  cwd?: string
  startedAt: number
  state: SupervisedState
  restartCount: number
  /** Epoch timestamps of recent restarts, used for the sliding-window budget. */
  restartTimestamps: number[]
  /** True once stop()/kill() initiated termination so exit is not treated as a crash. */
  intentionalStop: boolean
  cpuPercent?: number
  rssBytes?: number
  recentStderr: string[]
  sampler?: ReturnType<typeof setInterval>
  killTimer?: ReturnType<typeof setTimeout>
  idleTimer?: ReturnType<typeof setTimeout>
  restartTimer?: ReturnType<typeof setTimeout>
}

export class SidecarProcessSupervisor {
  private readonly _pidusage: PidusageSampler
  private readonly _treeKill: TreeKill
  private readonly entries = new Map<string, SupervisedEntry>()

  constructor(deps: SidecarProcessSupervisorDeps = {}) {
    this._pidusage = deps.pidusage ?? pidusage
    this._treeKill = deps.treeKill ?? treeKill
  }

  spawn(spec: SupervisedSpawnSpec): SupervisedHandle {
    const child = spec.spawn()
    const id = this.generateId(spec.name, spec.key)

    const entry: SupervisedEntry = {
      id,
      name: spec.name,
      key: spec.key,
      process: child,
      spawn: spec.spawn,
      onExit: spec.onExit,
      binaryPath: spec.binaryPath,
      binaryVersion: spec.binaryVersion,
      cwd: spec.cwd,
      startedAt: Date.now(),
      state: 'running',
      restartCount: 0,
      restartTimestamps: [],
      intentionalStop: false,
      recentStderr: []
    }

    this.entries.set(id, entry)
    this.attachChild(entry, child)

    logger.info(`sidecar spawned: ${id}`, { pid: child.pid, binaryPath: spec.binaryPath })

    return {
      id,
      // Read the live child: after a restart entry.process is swapped, so a
      // value-captured reference would dangle on the dead child.
      get process() {
        return entry.process
      },
      status: () => this.snapshot(entry)
    }
  }

  /**
   * Wire a freshly-spawned child into an entry: stderr ring buffer, the shared
   * exit handler, and the resource sampler. Shared by spawn() and restart so
   * per-child setup stays DRY and identical across the entry's lifetime.
   */
  private attachChild(entry: SupervisedEntry, child: ChildProcess): void {
    child.stderr?.on('data', (chunk: Buffer | string) => {
      this.appendStderr(entry, chunk)
    })

    child.once('exit', (code, signal) => {
      this.handleExit(entry, code, signal)
    })

    this.startSampler(entry)
  }

  /**
   * Shared 'exit' handler for every supervised child. Releases all timers and
   * the sampler, then either settles the entry (intentional termination) or
   * attempts an automatic restart subject to the budget (unexpected crash).
   */
  private handleExit(entry: SupervisedEntry, code: number | null, signal: NodeJS.Signals | null): void {
    this.stopSampler(entry)
    this.clearKillTimer(entry)
    this.clearIdleTimer(entry)
    logger.info(`sidecar exited: ${entry.id}`, { code, signal, intentional: entry.intentionalStop })
    entry.onExit?.(code, signal)

    if (entry.intentionalStop) {
      // Operator-initiated stop()/kill(): settle as stopped, never restart.
      entry.state = 'stopped'
      return
    }

    this.scheduleRestart(entry)
  }

  /**
   * Schedule an automatic restart after a crash, honouring the sliding-window
   * budget. If the budget is exhausted the entry is moved to 'failed' and left
   * dead. The new child reuses the same entry/id (no new list() row).
   */
  private scheduleRestart(entry: SupervisedEntry): void {
    const now = Date.now()
    // Drop restart timestamps that have aged out of the sliding window.
    entry.restartTimestamps = entry.restartTimestamps.filter((ts) => now - ts < RESTART_WINDOW_MS)

    if (entry.restartTimestamps.length >= RESTART_BUDGET) {
      entry.state = 'failed'
      logger.error(`sidecar exceeded restart budget; giving up: ${entry.id}`, {
        name: entry.name,
        budget: RESTART_BUDGET,
        windowMs: RESTART_WINDOW_MS
      })
      return
    }

    const backoffIndex = Math.min(entry.restartCount, RESTART_BACKOFF_MS.length - 1)
    const delay = RESTART_BACKOFF_MS[backoffIndex]
    entry.restartTimestamps.push(now)

    // Mark 'restarting' so stop()/kill() during the backoff window can detect a
    // pending restart and settle terminally instead of treeKill'ing the dead pid
    // and arming an escalation timer on a child whose 'exit' already fired.
    entry.state = 'restarting'

    const restartTimer = setTimeout(() => {
      this.restart(entry)
    }, delay)
    restartTimer.unref()
    entry.restartTimer = restartTimer
  }

  /**
   * Restart a crashed sidecar in place: spawn a fresh child via the stored
   * thunk, swap it onto the same entry, and re-run per-child wiring.
   */
  private restart(entry: SupervisedEntry): void {
    entry.restartTimer = undefined
    const child = entry.spawn()
    entry.process = child
    entry.restartCount += 1
    entry.state = 'running'
    entry.startedAt = Date.now()
    this.attachChild(entry, child)
    logger.info(`sidecar restarted: ${entry.id}`, { pid: child.pid, restartCount: entry.restartCount })
  }

  list(): SupervisedSidecarStatus[] {
    return Array.from(this.entries.values()).map((entry) => this.snapshot(entry))
  }

  get(id: string): SupervisedSidecarStatus | undefined {
    const entry = this.entries.get(id)
    return entry ? this.snapshot(entry) : undefined
  }

  /**
   * Gracefully terminate a supervised sidecar: SIGTERM the whole process tree,
   * then escalate to SIGKILL if it does not exit within {@link KILL_ESCALATION_MS}.
   * Idempotent; resolves once the process has exited or after SIGKILL is issued.
   */
  async stop(id: string): Promise<void> {
    const entry = this.entries.get(id)
    // Short-circuit a concurrent stop() already in flight: re-entering would
    // attach a second 'exit' listener and clobber entry.killTimer, leaking the
    // first timer (which later fires an orphaned SIGKILL at a possibly-recycled pid).
    if (!entry || this.hasExited(entry) || entry.state === 'stopping') {
      return
    }

    // Stop requested while a restart is pending: the old child is already dead
    // and its 'exit' was consumed. treeKill+once('exit') here would strand the
    // entry forever. Cancel the restart and settle terminally instead.
    if (entry.state === 'restarting') {
      entry.intentionalStop = true
      this.clearRestartTimer(entry)
      this.settleAsFailed(entry)
      return
    }

    // Mark intentional first so a restart is never scheduled for this exit,
    // and release idle/restart timers that could otherwise act on a dead entry.
    entry.intentionalStop = true
    this.clearIdleTimer(entry)
    this.clearRestartTimer(entry)

    entry.state = 'stopping'
    const pid = entry.process.pid
    if (pid === undefined) {
      // No pid to signal: settle into a terminal state so the entry does not
      // strand in 'stopping' (which would make hasExited() false forever and
      // turn every future stop/kill into a silent no-op).
      this.settleAsFailed(entry)
      return
    }

    logger.info(`sidecar stop requested: ${id}`, { pid })
    this._treeKill(pid, 'SIGTERM')

    await new Promise<void>((resolve) => {
      const onExit = (): void => {
        this.clearKillTimer(entry)
        resolve()
      }
      entry.process.once('exit', onExit)

      entry.killTimer = setTimeout(() => {
        // Process did not exit in time; escalate and stop waiting. The 'exit'
        // listener stays armed so the shared handler still runs on real exit.
        entry.process.removeListener('exit', onExit)
        logger.warn(`sidecar did not exit after SIGTERM; escalating to SIGKILL: ${id}`, { pid })
        this._treeKill(pid, 'SIGKILL')
        resolve()
      }, KILL_ESCALATION_MS)
      entry.killTimer.unref()
    })
  }

  /**
   * Immediately terminate a supervised sidecar via SIGKILL on the process tree.
   * Idempotent; no-op for unknown or already-exited entries.
   */
  async kill(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry || this.hasExited(entry)) {
      return
    }

    // Kill requested while a restart is pending: the old child is already dead.
    // Cancel the restart and settle terminally rather than signalling a dead pid.
    if (entry.state === 'restarting') {
      entry.intentionalStop = true
      this.clearRestartTimer(entry)
      this.settleAsFailed(entry)
      return
    }

    // Mark intentional first so a restart is never scheduled for this exit,
    // and release idle/restart timers that could otherwise act on a dead entry.
    entry.intentionalStop = true
    this.clearIdleTimer(entry)
    this.clearRestartTimer(entry)

    entry.state = 'stopping'
    const pid = entry.process.pid
    if (pid === undefined) {
      // No pid to signal: settle into a terminal state so the entry does not
      // strand in 'stopping' and future stop/kill stay clean no-ops.
      this.settleAsFailed(entry)
      return
    }

    this._treeKill(pid, 'SIGKILL')
  }

  /**
   * Cancel any pending idle-shutdown timer for an entry: the sidecar is in use
   * again, so it must not be reaped while active.
   */
  markActive(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) {
      return
    }
    this.clearIdleTimer(entry)
  }

  /**
   * Arm (or re-arm) an idle-shutdown timer for an entry. After
   * {@link IDLE_SHUTDOWN_MS} of continuous idleness the sidecar is gracefully
   * stopped. Re-calling resets the timer; markActive cancels it.
   */
  markIdle(id: string): void {
    const entry = this.entries.get(id)
    if (!entry || this.hasExited(entry)) {
      return
    }

    this.clearIdleTimer(entry)
    const idleTimer = setTimeout(() => {
      void this.stop(id)
    }, IDLE_SHUTDOWN_MS)
    idleTimer.unref()
    entry.idleTimer = idleTimer
  }

  /**
   * Transition an entry that has no pid to signal into the terminal 'failed'
   * state, releasing its sampler/kill timer the way the shared 'exit' handler
   * would. Used when stop()/kill() cannot deliver a signal.
   */
  private settleAsFailed(entry: SupervisedEntry): void {
    entry.state = 'failed'
    this.stopSampler(entry)
    this.clearKillTimer(entry)
    this.clearIdleTimer(entry)
    this.clearRestartTimer(entry)
  }

  private generateId(name: string, key?: string): string {
    const baseId = `${name}:${key ?? 'default'}`
    if (!this.entries.has(baseId)) {
      return baseId
    }

    let counter = 1
    let candidate = `${baseId}#${counter}`
    while (this.entries.has(candidate)) {
      counter += 1
      candidate = `${baseId}#${counter}`
    }
    return candidate
  }

  private startSampler(entry: SupervisedEntry): void {
    const sampler = setInterval(() => {
      void this.sampleResources(entry)
    }, RESOURCE_SAMPLE_MS)
    // Allow the process to exit even if a sampler is still scheduled.
    sampler.unref()
    entry.sampler = sampler
  }

  private stopSampler(entry: SupervisedEntry): void {
    if (entry.sampler) {
      clearInterval(entry.sampler)
      entry.sampler = undefined
    }
  }

  private clearKillTimer(entry: SupervisedEntry): void {
    if (entry.killTimer) {
      clearTimeout(entry.killTimer)
      entry.killTimer = undefined
    }
  }

  private clearIdleTimer(entry: SupervisedEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = undefined
    }
  }

  private clearRestartTimer(entry: SupervisedEntry): void {
    if (entry.restartTimer) {
      clearTimeout(entry.restartTimer)
      entry.restartTimer = undefined
    }
  }

  private hasExited(entry: SupervisedEntry): boolean {
    return entry.state === 'stopped' || entry.state === 'failed'
  }

  private async sampleResources(entry: SupervisedEntry): Promise<void> {
    const pid = entry.process.pid
    if (pid === undefined) {
      return
    }

    try {
      const stats = await this._pidusage(pid)
      // The sample may resolve after the child has exited OR after a crash
      // restart swapped in a fresh child (state never passes through 'stopped'
      // on that path). Drop the late sample if the entry is terminal or the live
      // pid no longer matches the one we sampled, so stale data from the old
      // child neither overwrites cpu/rss nor fires a spurious warn.
      if (this.hasExited(entry) || entry.process.pid !== pid) {
        return
      }
      entry.cpuPercent = stats.cpu
      entry.rssBytes = stats.memory

      if (stats.cpu >= CPU_WARN_PERCENT || stats.memory >= RSS_WARN_BYTES) {
        logger.warn(`sidecar resource usage high: ${entry.id}`, {
          name: entry.name,
          pid,
          cpuPercent: stats.cpu,
          rssBytes: stats.memory
        })
      }
    } catch (error) {
      // The process may have already exited between samples; observe-only, so swallow.
      logger.debug(`sidecar resource sample failed: ${entry.id}`, { pid, error })
    }
  }

  private appendStderr(entry: SupervisedEntry, chunk: Buffer | string): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const lines = text.split('\n').filter((line) => line.length > 0)
    if (lines.length === 0) {
      return
    }

    entry.recentStderr.push(...lines)
    if (entry.recentStderr.length > STDERR_RING_SIZE) {
      entry.recentStderr.splice(0, entry.recentStderr.length - STDERR_RING_SIZE)
    }
  }

  private snapshot(entry: SupervisedEntry): SupervisedSidecarStatus {
    return {
      id: entry.id,
      name: entry.name,
      key: entry.key,
      pid: entry.process.pid,
      binaryPath: entry.binaryPath,
      binaryVersion: entry.binaryVersion,
      cwd: entry.cwd,
      startedAt: entry.startedAt,
      state: entry.state,
      restartCount: entry.restartCount,
      cpuPercent: entry.cpuPercent,
      rssBytes: entry.rssBytes,
      recentStderr: [...entry.recentStderr]
    }
  }
}

export const sidecarProcessSupervisor = new SidecarProcessSupervisor()
