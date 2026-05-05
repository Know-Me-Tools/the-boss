import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'

import { findExecutableInEnv } from '@main/utils/process'
import type { AgentRuntimeKind } from '@types'

const execFileAsync = promisify(execFile)
const VERSION_TIMEOUT_MS = 3000

export type RuntimeBinarySource = 'configured' | 'environment' | 'path' | 'managed' | 'development'
export type DiscoverableRuntimeKind = Extract<AgentRuntimeKind, 'codex' | 'opencode' | 'uar'>

export interface RuntimeBinaryDiscoveryResult {
  kind: AgentRuntimeKind
  command: string
  detectedPath?: string
  version?: string
  source: 'path'
  available: boolean
  message: string
}

const RUNTIME_COMMANDS: Record<DiscoverableRuntimeKind, string> = {
  codex: 'codex',
  opencode: 'opencode',
  uar: 'universal-agent-runtime'
}

interface RuntimeBinaryDiscoveryServiceDependencies {
  findExecutable?: (name: string) => Promise<string | null>
  readVersion?: (binaryPath: string) => Promise<string | undefined>
}

export class RuntimeBinaryDiscoveryService {
  private readonly findExecutable: (name: string) => Promise<string | null>
  private readonly readVersion: (binaryPath: string) => Promise<string | undefined>

  constructor(dependencies: RuntimeBinaryDiscoveryServiceDependencies = {}) {
    this.findExecutable = dependencies.findExecutable ?? findExecutableInEnv
    this.readVersion = dependencies.readVersion ?? readRuntimeVersion
  }

  async discover(kind: AgentRuntimeKind): Promise<RuntimeBinaryDiscoveryResult> {
    const command = readRuntimeCommand(kind)
    if (!command) {
      return {
        kind,
        command: String(kind),
        source: 'path',
        available: false,
        message: `${kind} runtime does not support PATH discovery.`
      }
    }

    const detectedPath = await this.findExecutable(command)
    if (!detectedPath) {
      return {
        kind,
        command,
        source: 'path',
        available: false,
        message: `${command} was not found on PATH.`
      }
    }

    const stats = await stat(detectedPath).catch(() => null)
    if (!stats?.isFile()) {
      return {
        kind,
        command,
        detectedPath,
        source: 'path',
        available: false,
        message: `${command} was found on PATH but is not a file: ${detectedPath}`
      }
    }

    const version = await this.readVersion(detectedPath)
    return {
      kind,
      command,
      detectedPath,
      version,
      source: 'path',
      available: true,
      message: version
        ? `${command} was detected on PATH at ${detectedPath} (${version}).`
        : `${command} was detected on PATH at ${detectedPath}.`
    }
  }
}

export function readRuntimeCommand(kind: AgentRuntimeKind): string | undefined {
  return RUNTIME_COMMANDS[kind as DiscoverableRuntimeKind]
}

async function readRuntimeVersion(binaryPath: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync(binaryPath, ['--version'], {
      timeout: VERSION_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 64
    })
    return normalizeVersionOutput(`${result.stdout ?? ''}${result.stderr ? ` ${result.stderr}` : ''}`)
  } catch {
    return undefined
  }
}

function normalizeVersionOutput(value: string): string | undefined {
  const version = value.replace(/\s+/g, ' ').trim()
  return version || undefined
}

export const runtimeBinaryDiscoveryService = new RuntimeBinaryDiscoveryService()
