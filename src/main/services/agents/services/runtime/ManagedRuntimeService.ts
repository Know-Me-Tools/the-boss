import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { getResourcePath } from '@main/utils'
import { CONTROL_PLANE_API_URL } from '@shared/config/branding'

import {
  getManagedBinaryService,
  type ManagedBinaryManifest,
  type ManagedBinaryResolution,
  type ManagedBinaryService,
  type ManagedBinaryStatus
} from './ManagedBinaryService'

const logger = loggerService.withContext('ManagedRuntimeService')

export type ManagedRuntimeName = 'universal-agent-runtime' | 'opencode' | 'codex'

const RUNTIME_ENDPOINT_SLUGS: Record<ManagedRuntimeName, string> = {
  'universal-agent-runtime': 'uar',
  opencode: 'opencode',
  codex: 'codex'
}

const BOOTSTRAP_MANIFEST_PATH = path.join('runtime-manifests', 'bootstrap.json')

const EMPTY_BOOTSTRAP_MANIFESTS: ManagedBinaryManifest[] = [
  {
    name: 'universal-agent-runtime',
    version: 'bootstrap',
    binaries: []
  },
  {
    name: 'opencode',
    version: 'bootstrap',
    binaries: []
  },
  {
    name: 'codex',
    version: 'bootstrap',
    binaries: []
  }
]

export interface RuntimeManifestProvider {
  getManifest(name: ManagedRuntimeName): Promise<ManagedBinaryManifest>
}

export class ManagedRuntimeService {
  constructor(
    private readonly binaryService?: ManagedBinaryService,
    private readonly manifestProvider: RuntimeManifestProvider = new ControlPlaneRuntimeManifestProvider()
  ) {}

  async getManifest(name: ManagedRuntimeName): Promise<ManagedBinaryManifest> {
    return this.manifestProvider.getManifest(name)
  }

  async getStatus(name: ManagedRuntimeName): Promise<ManagedBinaryStatus> {
    return this.getBinaryService().getStatus(await this.getManifest(name))
  }

  async install(name: ManagedRuntimeName): Promise<ManagedBinaryStatus> {
    return this.getBinaryService().install(await this.getManifest(name))
  }

  async resolveInstalledBinary(name: ManagedRuntimeName): Promise<ManagedBinaryResolution> {
    return this.getBinaryService().resolveInstalledBinary(await this.getManifest(name))
  }

  reconcile(names: ManagedRuntimeName[] = ['universal-agent-runtime', 'opencode', 'codex']): void {
    for (const name of names) {
      void this.install(name).catch((error) => {
        logger.warn('Managed runtime reconciliation failed', {
          name,
          error: error instanceof Error ? error.message : String(error)
        })
      })
    }
  }

  private getBinaryService(): ManagedBinaryService {
    return this.binaryService ?? getManagedBinaryService()
  }
}

export class ControlPlaneRuntimeManifestProvider implements RuntimeManifestProvider {
  private bootstrapCache?: Map<ManagedRuntimeName, ManagedBinaryManifest>

  constructor(private readonly apiBaseUrl = process.env.THE_BOSS_RUNTIME_MANIFEST_URL ?? CONTROL_PLANE_API_URL) {}

  async getManifest(name: ManagedRuntimeName): Promise<ManagedBinaryManifest> {
    const bootstrap = this.getBootstrapManifest(name)
    const remote = await this.fetchRemoteManifest(name).catch((error) => {
      logger.debug('Runtime control-plane manifest unavailable; using bootstrap manifest', {
        name,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    })

    return remote ?? bootstrap
  }

  private async fetchRemoteManifest(name: ManagedRuntimeName): Promise<ManagedBinaryManifest | null> {
    const slug = RUNTIME_ENDPOINT_SLUGS[name]
    const { platform, arch } = getPlatformParts()
    const response = await fetch(
      `${withoutTrailingSlash(this.apiBaseUrl)}/runtimes/manifests/${slug}/${platform}/${arch}/latest`
    )
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return normalizeRemoteManifest(name, await response.json())
  }

  private getBootstrapManifest(name: ManagedRuntimeName): ManagedBinaryManifest {
    const manifest = this.getBootstrapManifests().get(name)
    if (!manifest) {
      throw new Error(`Missing bootstrap runtime manifest for ${name}`)
    }
    return manifest
  }

  private getBootstrapManifests(): Map<ManagedRuntimeName, ManagedBinaryManifest> {
    if (this.bootstrapCache) {
      return this.bootstrapCache
    }

    const manifestPath = path.join(getResourcePath(), BOOTSTRAP_MANIFEST_PATH)
    const parsed = readBootstrapManifestFile(manifestPath)
    const entries = new Map<ManagedRuntimeName, ManagedBinaryManifest>()
    for (const manifest of parsed.manifests ?? []) {
      if (isManagedRuntimeName(manifest.name)) {
        entries.set(manifest.name, manifest)
      }
    }

    this.bootstrapCache = entries
    return entries
  }
}

function readBootstrapManifestFile(manifestPath: string): { manifests?: ManagedBinaryManifest[] } {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { manifests?: ManagedBinaryManifest[] }
  } catch (error) {
    logger.debug('Runtime bootstrap manifest unavailable; using empty bootstrap manifests', {
      manifestPath,
      error: error instanceof Error ? error.message : String(error)
    })
    return {
      manifests: EMPTY_BOOTSTRAP_MANIFESTS
    }
  }
}

function normalizeRemoteManifest(name: ManagedRuntimeName, value: unknown): ManagedBinaryManifest | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as any
  if (record.name === name && Array.isArray(record.binaries)) {
    return hasUsableBinaryEntries(record) ? (record as ManagedBinaryManifest) : null
  }

  const artifact = record.artifact
  if (artifact && typeof artifact === 'object') {
    const platform = [record.platform, record.arch].filter(Boolean).join('-')
    const version = String(record.version || record.sourceCommit || 'latest')
    const binaryName = readBinaryName(name, platform)
    const manifest: ManagedBinaryManifest = {
      name,
      version,
      sourceCommit: typeof record.sourceCommit === 'string' ? record.sourceCommit : undefined,
      supportedPlatforms: platform ? [platform] : [],
      binaries: platform
        ? [
            {
              platform,
              binaryName,
              size: Number(artifact.size) || 0,
              maxSize: Number(artifact.maxSize) || undefined,
              sha256: String(artifact.sha256 || ''),
              httpsUrl: typeof artifact.httpsUrl === 'string' ? artifact.httpsUrl : undefined,
              ipfsCid: typeof artifact.ipfsCid === 'string' ? artifact.ipfsCid : undefined
            }
          ]
        : []
    }
    return hasUsableBinaryEntries(manifest) ? manifest : null
  }

  return null
}

function hasUsableBinaryEntries(manifest: ManagedBinaryManifest): boolean {
  return (
    manifest.binaries.length > 0 &&
    manifest.binaries.every(
      (binary) =>
        binary.platform &&
        binary.binaryName &&
        binary.size > 0 &&
        /^[a-f0-9]{64}$/i.test(binary.sha256) &&
        Boolean(binary.ipfsCid || binary.httpsUrl)
    )
  )
}

function readBinaryName(name: ManagedRuntimeName, platform: string): string {
  if (name === 'universal-agent-runtime') {
    return platform.startsWith('win32-') ? 'universal-agent-runtime.exe' : 'universal-agent-runtime'
  }
  if (name === 'opencode') {
    return platform.startsWith('win32-') ? 'opencode.exe' : 'opencode'
  }
  return platform.startsWith('win32-') ? 'codex.exe' : 'codex'
}

function getPlatformParts(): { platform: string; arch: string } {
  return {
    platform: process.platform,
    arch: process.arch
  }
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function isManagedRuntimeName(value: string): value is ManagedRuntimeName {
  return value === 'universal-agent-runtime' || value === 'opencode' || value === 'codex'
}

export const managedRuntimeService = new ManagedRuntimeService()
