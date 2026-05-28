import { createPublicKey, verify } from 'node:crypto'
import fs from 'node:fs'
import fsAsync from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { getDataPath, getResourcePath } from '@main/utils'
import { CONTROL_PLANE_API_URL } from '@shared/config/branding'

import {
  getManagedBinaryService,
  type ManagedBinaryInstallOptions,
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

export interface RuntimeManifestTrustKey {
  keyId: string
  publicKey: string
}

export interface RuntimeManifestTrustStore {
  getHighestSequence(name: ManagedRuntimeName): Promise<number | undefined>
  setHighestSequence(name: ManagedRuntimeName, sequence: number): Promise<void>
  getLastVerifiedManifest(name: ManagedRuntimeName): Promise<ManagedBinaryManifest | null>
  setLastVerifiedManifest(name: ManagedRuntimeName, manifest: ManagedBinaryManifest): Promise<void>
}

interface ControlPlaneRuntimeManifestProviderOptions {
  trustKeys?: RuntimeManifestTrustKey[]
  trustStore?: RuntimeManifestTrustStore
  allowUnsignedManifests?: boolean
  channelManifestName?: string
  channelGatewayUrls?: string[]
  channelHttpsUrl?: string
  now?: () => Date
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

  async install(name: ManagedRuntimeName, options?: ManagedBinaryInstallOptions): Promise<ManagedBinaryStatus> {
    return this.getBinaryService().install(await this.getManifest(name), options)
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
  private readonly trustKeys: RuntimeManifestTrustKey[]
  private readonly trustStore: RuntimeManifestTrustStore
  private readonly allowUnsignedManifests: boolean
  private readonly channelManifestName?: string
  private readonly channelGatewayUrls: string[]
  private readonly channelHttpsUrl?: string
  private readonly now: () => Date

  constructor(
    private readonly apiBaseUrl = process.env.THE_BOSS_RUNTIME_MANIFEST_URL ?? CONTROL_PLANE_API_URL,
    options: ControlPlaneRuntimeManifestProviderOptions = {}
  ) {
    this.trustKeys = options.trustKeys ?? readRuntimeManifestTrustKeys()
    this.trustStore = options.trustStore ?? new FileRuntimeManifestTrustStore()
    this.allowUnsignedManifests =
      options.allowUnsignedManifests ?? process.env.THE_BOSS_ALLOW_UNSIGNED_RUNTIME_MANIFESTS === 'true'
    this.channelManifestName = options.channelManifestName ?? process.env.THE_BOSS_RUNTIME_MANIFEST_NAME
    this.channelGatewayUrls = options.channelGatewayUrls ?? readRuntimeManifestGatewayUrls()
    this.channelHttpsUrl = options.channelHttpsUrl ?? process.env.THE_BOSS_RUNTIME_MANIFEST_HTTPS_URL
    this.now = options.now ?? (() => new Date())
  }

  async getManifest(name: ManagedRuntimeName): Promise<ManagedBinaryManifest> {
    const bootstrap = this.getBootstrapManifest(name)
    const lastVerified = await this.trustStore.getLastVerifiedManifest(name).catch((error) => {
      logger.debug('Last verified runtime manifest unavailable', {
        name,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    })
    const channel = await this.fetchChannelManifest(name).catch((error) => {
      logger.debug('Runtime channel manifest unavailable; trying control-plane manifest', {
        name,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    })
    const remote =
      channel ??
      (await this.fetchRemoteManifest(name).catch((error) => {
        logger.debug('Runtime control-plane manifest unavailable; using cached/bootstrap manifest', {
          name,
          error: error instanceof Error ? error.message : String(error)
        })
        return null
      }))

    if (!remote) {
      return lastVerified ?? bootstrap
    }

    const accepted = await this.acceptRemoteManifest(name, remote).catch((error) => {
      logger.warn('Runtime control-plane manifest rejected; using cached/bootstrap manifest', {
        name,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    })

    return accepted ?? lastVerified ?? bootstrap
  }

  private async fetchChannelManifest(name: ManagedRuntimeName): Promise<ManagedBinaryManifest | null> {
    const urls = this.getChannelManifestUrls()
    if (urls.length === 0) {
      return null
    }

    let lastError: unknown
    for (const url of urls) {
      try {
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        return normalizeChannelManifest(name, await response.json())
      } catch (error) {
        lastError = error
        logger.debug('Runtime channel manifest URL failed', {
          name,
          url: url.toString(),
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Runtime channel manifest fetch failed.')
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

  private getChannelManifestUrls(): URL[] {
    const urls: URL[] = []
    if (this.channelManifestName) {
      for (const gateway of this.channelGatewayUrls) {
        urls.push(resolveRuntimeManifestGatewayUrl(gateway, this.channelManifestName))
      }
    }
    if (this.channelHttpsUrl) {
      urls.push(new URL(this.channelHttpsUrl))
    }
    return urls
  }

  private async acceptRemoteManifest(
    name: ManagedRuntimeName,
    manifest: ManagedBinaryManifest
  ): Promise<ManagedBinaryManifest | null> {
    assertRuntimeManifestTrusted(name, manifest, {
      trustKeys: this.trustKeys,
      allowUnsigned: this.allowUnsignedManifests,
      highestSequence: await this.trustStore.getHighestSequence(name),
      now: this.now()
    })

    if (typeof manifest.sequence === 'number') {
      await this.trustStore.setHighestSequence(name, manifest.sequence)
    }
    await this.trustStore.setLastVerifiedManifest(name, manifest)
    return manifest
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

export class FileRuntimeManifestTrustStore implements RuntimeManifestTrustStore {
  constructor(private readonly configuredRootDir?: string) {}

  async getHighestSequence(name: ManagedRuntimeName): Promise<number | undefined> {
    const state = await this.readState(name)
    return typeof state.highestSequence === 'number' ? state.highestSequence : undefined
  }

  async setHighestSequence(name: ManagedRuntimeName, sequence: number): Promise<void> {
    const state = await this.readState(name)
    if (typeof state.highestSequence === 'number' && state.highestSequence > sequence) {
      return
    }
    await this.writeState(name, { ...state, highestSequence: sequence })
  }

  async getLastVerifiedManifest(name: ManagedRuntimeName): Promise<ManagedBinaryManifest | null> {
    try {
      return JSON.parse(await fsAsync.readFile(this.manifestPath(name), 'utf8')) as ManagedBinaryManifest
    } catch {
      return null
    }
  }

  async setLastVerifiedManifest(name: ManagedRuntimeName, manifest: ManagedBinaryManifest): Promise<void> {
    await fsAsync.mkdir(this.rootDir(), { recursive: true })
    await fsAsync.writeFile(this.manifestPath(name), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }

  private async readState(name: ManagedRuntimeName): Promise<{ highestSequence?: number }> {
    try {
      return JSON.parse(await fsAsync.readFile(this.statePath(name), 'utf8')) as { highestSequence?: number }
    } catch {
      return {}
    }
  }

  private async writeState(name: ManagedRuntimeName, state: { highestSequence?: number }): Promise<void> {
    await fsAsync.mkdir(this.rootDir(), { recursive: true })
    await fsAsync.writeFile(this.statePath(name), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }

  private manifestPath(name: ManagedRuntimeName): string {
    return path.join(this.rootDir(), `${sanitizeRuntimeName(name)}.verified.json`)
  }

  private statePath(name: ManagedRuntimeName): string {
    return path.join(this.rootDir(), `${sanitizeRuntimeName(name)}.state.json`)
  }

  private rootDir(): string {
    return this.configuredRootDir ?? getDataPath('runtime-manifests')
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

function normalizeChannelManifest(name: ManagedRuntimeName, value: unknown): ManagedBinaryManifest | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as any
  if (record.name === name && Array.isArray(record.binaries)) {
    return normalizeRemoteManifest(name, record)
  }

  const manifests = Array.isArray(record.manifests) ? record.manifests : []
  const manifest = manifests.find((candidate: any) => candidate?.name === name)
  return manifest ? normalizeRemoteManifest(name, manifest) : null
}

export function assertRuntimeManifestTrusted(
  name: ManagedRuntimeName,
  manifest: ManagedBinaryManifest,
  options: {
    trustKeys: RuntimeManifestTrustKey[]
    allowUnsigned?: boolean
    highestSequence?: number
    now?: Date
  }
): void {
  if (manifest.name !== name) {
    throw new Error(`Runtime manifest name mismatch: expected ${name}, got ${manifest.name}.`)
  }
  if (!hasUsableBinaryEntries(manifest)) {
    throw new Error(`Runtime manifest for ${name} has no usable binary entries.`)
  }
  if (manifest.expiresAt) {
    const expiresAt = Date.parse(manifest.expiresAt)
    if (!Number.isFinite(expiresAt)) {
      throw new Error(`Runtime manifest for ${name} has an invalid expiresAt value.`)
    }
    if ((options.now ?? new Date()).getTime() > expiresAt) {
      throw new Error(`Runtime manifest for ${name} has expired.`)
    }
  }

  if (typeof manifest.sequence === 'number') {
    if (!Number.isSafeInteger(manifest.sequence) || manifest.sequence < 0) {
      throw new Error(`Runtime manifest for ${name} has an invalid sequence.`)
    }
    if (typeof options.highestSequence === 'number' && manifest.sequence < options.highestSequence) {
      throw new Error(
        `Runtime manifest rollback rejected for ${name}: sequence ${manifest.sequence} is below ${options.highestSequence}.`
      )
    }
  }

  if (manifest.revokedArtifacts?.length) {
    const revoked = new Set(manifest.revokedArtifacts)
    for (const binary of manifest.binaries) {
      if (revoked.has(binary.sha256) || (binary.ipfsCid && revoked.has(binary.ipfsCid))) {
        throw new Error(`Runtime manifest for ${name} references a revoked artifact.`)
      }
    }
  }

  if (!manifest.signature) {
    if (options.allowUnsigned) {
      return
    }
    throw new Error(`Runtime manifest for ${name} is unsigned.`)
  }
  if (manifest.signature.algorithm !== 'ed25519') {
    throw new Error(`Runtime manifest for ${name} uses unsupported signature algorithm.`)
  }

  const key = options.trustKeys.find((candidate) => candidate.keyId === manifest.signature?.keyId)
  if (!key) {
    throw new Error(`Runtime manifest for ${name} is signed by an unknown key.`)
  }
  if (!verifyRuntimeManifestSignature(manifest, key.publicKey)) {
    throw new Error(`Runtime manifest signature verification failed for ${name}.`)
  }
}

export function runtimeManifestSigningPayload(manifest: ManagedBinaryManifest): string {
  const unsignedManifest = { ...manifest }
  delete unsignedManifest.signature
  return canonicalJson(unsignedManifest)
}

function verifyRuntimeManifestSignature(manifest: ManagedBinaryManifest, publicKeyPem: string): boolean {
  try {
    const publicKey = createPublicKey(publicKeyPem)
    return verify(
      null,
      Buffer.from(runtimeManifestSigningPayload(manifest)),
      publicKey,
      Buffer.from(manifest.signature!.value, 'base64')
    )
  } catch (error) {
    logger.warn('Runtime manifest signature verification errored', {
      name: manifest.name,
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

function readRuntimeManifestTrustKeys(): RuntimeManifestTrustKey[] {
  const raw = process.env.THE_BOSS_RUNTIME_MANIFEST_PUBLIC_KEYS
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as RuntimeManifestTrustKey[]
    return Array.isArray(parsed)
      ? parsed.filter((key) => typeof key.keyId === 'string' && typeof key.publicKey === 'string')
      : []
  } catch (error) {
    logger.warn('Failed to parse runtime manifest public keys', {
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

function readRuntimeManifestGatewayUrls(): string[] {
  const raw = process.env.THE_BOSS_RUNTIME_MANIFEST_GATEWAY_URLS
  if (!raw) {
    return ['https://ipfs.prometheusags.ai', 'https://ipfs.io']
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
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

function resolveRuntimeManifestGatewayUrl(gateway: string, manifestName: string): URL {
  if (/^https?:\/\//i.test(manifestName)) {
    return new URL(manifestName)
  }

  const base = withoutTrailingSlash(gateway)
  const cleanName = manifestName.replace(/^\/+/, '')
  if (cleanName.startsWith('ipfs/') || cleanName.startsWith('ipns/')) {
    return new URL(`${base}/${cleanName}`)
  }

  return new URL(`${base}/ipns/${cleanName}`)
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

function sanitizeRuntimeName(name: ManagedRuntimeName): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '-')
}

function isManagedRuntimeName(value: string): value is ManagedRuntimeName {
  return value === 'universal-agent-runtime' || value === 'opencode' || value === 'codex'
}

export const managedRuntimeService = new ManagedRuntimeService()
