import type { ChildProcess } from 'node:child_process'

import { loggerService } from '@logger'
import pidusage from 'pidusage'
import treeKill from 'tree-kill'

const logger = loggerService.withContext('SidecarProcessSupervisor')

/**
 * Maximum number of recent stderr lines retained per supervised sidecar.
 */
export const STDERR_RING_SIZE = 50

type SupervisedState = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'

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

type Pidusage = typeof pidusage
type TreeKill = typeof treeKill

export interface SidecarProcessSupervisorDeps {
  pidusage?: Pidusage
  treeKill?: TreeKill
}

interface SupervisedEntry {
  id: string
  name: string
  key?: string
  process: ChildProcess
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

export class SidecarProcessSupervisor {
  private readonly _pidusage: Pidusage
  private readonly _treeKill: TreeKill
  private readonly entries = new Map<string, SupervisedEntry>()

  constructor(deps: SidecarProcessSupervisorDeps = {}) {
    this._pidusage = deps.pidusage ?? pidusage
    this._treeKill = deps.treeKill ?? treeKill
    // Retained for later tasks (resource sampling / tree-kill teardown); referenced
    // here so the compiler does not flag them as unused under noUnusedLocals.
    void this._pidusage
    void this._treeKill
  }

  spawn(spec: SupervisedSpawnSpec): SupervisedHandle {
    const child = spec.spawn()
    const id = this.generateId(spec.name, spec.key)

    const entry: SupervisedEntry = {
      id,
      name: spec.name,
      key: spec.key,
      process: child,
      binaryPath: spec.binaryPath,
      binaryVersion: spec.binaryVersion,
      cwd: spec.cwd,
      startedAt: Date.now(),
      state: 'running',
      restartCount: 0,
      recentStderr: []
    }

    this.entries.set(id, entry)

    child.stderr?.on('data', (chunk: Buffer | string) => {
      this.appendStderr(entry, chunk)
    })

    child.once('exit', (code, signal) => {
      entry.state = 'stopped'
      logger.info(`sidecar exited: ${id}`, { code, signal })
      spec.onExit?.(code, signal)
    })

    logger.info(`sidecar spawned: ${id}`, { pid: child.pid, binaryPath: spec.binaryPath })

    return {
      id,
      process: child,
      status: () => this.snapshot(entry)
    }
  }

  list(): SupervisedSidecarStatus[] {
    return Array.from(this.entries.values()).map((entry) => this.snapshot(entry))
  }

  get(id: string): SupervisedSidecarStatus | undefined {
    const entry = this.entries.get(id)
    return entry ? this.snapshot(entry) : undefined
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
