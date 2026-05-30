/**
 * Cross-process runtime types for the agents sidecar supervisor.
 *
 * This module is the single source of truth for the serializable supervisor
 * status shape shared across the IPC boundary (main supervisor → preload →
 * renderer). It MUST stay free of main-only / node-only imports (no
 * `ChildProcess`, no node builtins) so the web typegraph stays clean.
 */

/**
 * Lifecycle state of a supervised sidecar process.
 */
export type SupervisedState = 'starting' | 'running' | 'restarting' | 'stopping' | 'stopped' | 'failed'

/**
 * Serializable snapshot of a supervised sidecar, safe to send across IPC.
 */
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
