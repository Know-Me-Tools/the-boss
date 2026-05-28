import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsAsync from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'

const logger = loggerService.withContext('ManagedBinaryService')

export type ManagedBinaryStatusState =
  | 'missing'
  | 'installed'
  | 'verifying'
  | 'verification-failed'
  | 'downloading'
  | 'download-failed'
  | 'unsupported-platform'
  | 'update-available'
  | 'previous-version-retained'

export interface ManagedBinarySignatureFields {
  minisign?: string
  cosignBundle?: string
  certificateSha256?: string
}

export interface ManagedBinaryManifestEntry {
  platform: string
  binaryName: string
  size: number
  maxSize?: number
  sha256: string
  httpsUrl?: string
  ipfsCid?: string
  ipfsPath?: string
  signatures?: ManagedBinarySignatureFields
}

export interface ManagedBinaryManifest {
  schemaVersion?: number
  name: string
  version: string
  channel?: string
  sequence?: number
  publishedAt?: string
  expiresAt?: string
  minAppVersion?: string
  maxAppVersion?: string
  sourceCommit?: string
  supportedPlatforms?: string[]
  revokedArtifacts?: string[]
  signature?: ManagedBinaryManifestSignature
  binaries: ManagedBinaryManifestEntry[]
}

export interface ManagedBinaryManifestSignature {
  algorithm: 'ed25519'
  keyId: string
  value: string
}

export interface ManagedBinaryStatus {
  name: string
  version: string
  platform: string
  state: ManagedBinaryStatusState
  binaryPath?: string
  message: string
}

export interface ManagedBinaryResolution {
  status: ManagedBinaryStatus
  binaryPath?: string
}

export interface ManagedBinaryTransport {
  canDownload(url: URL): boolean
  download(url: URL, destinationPath: string, options?: ManagedBinaryDownloadOptions): Promise<void>
}

export interface ManagedBinaryProgress {
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  phase: string
  progress?: number
  receivedBytes?: number
  totalBytes?: number
  message?: string
  code?: string
}

export interface ManagedBinaryInstallOptions {
  signal?: AbortSignal
  timeoutMs?: number
  onProgress?: (progress: ManagedBinaryProgress) => void
}

interface ManagedBinaryDownloadOptions extends ManagedBinaryInstallOptions {
  maxSize?: number
  totalBytes?: number
}

interface ManagedBinaryServiceOptions {
  rootDir?: string
  platformKey?: string
  transports?: ManagedBinaryTransport[]
}

const DEFAULT_MANAGED_BINARY_DOWNLOAD_TIMEOUT_MS = 10 * 60_000

export class ManagedBinaryService {
  private readonly rootDir: string
  private readonly platformKey: string
  private readonly transports: ManagedBinaryTransport[]

  constructor(options: ManagedBinaryServiceOptions = {}) {
    this.rootDir = options.rootDir ?? getDataPath('managed-binaries')
    this.platformKey = options.platformKey ?? getCurrentPlatformKey()
    this.transports = options.transports ?? [
      new FileManagedBinaryTransport(),
      new IpfsGatewayTransport(),
      new HttpsManagedBinaryTransport()
    ]
  }

  getInstallDir(manifest: ManagedBinaryManifest, platform = this.platformKey): string {
    return path.join(this.rootDir, sanitizePathSegment(manifest.name), sanitizePathSegment(manifest.version), platform)
  }

  getBinaryPath(manifest: ManagedBinaryManifest, entry = this.requireEntry(manifest)): string {
    return path.join(this.getInstallDir(manifest, entry.platform), entry.binaryName)
  }

  selectEntry(manifest: ManagedBinaryManifest, platform = this.platformKey): ManagedBinaryManifestEntry | null {
    if (manifest.supportedPlatforms?.length && !manifest.supportedPlatforms.includes(platform)) {
      return null
    }

    return manifest.binaries.find((binary) => binary.platform === platform) ?? null
  }

  async getStatus(manifest: ManagedBinaryManifest): Promise<ManagedBinaryStatus> {
    if (manifest.binaries.length === 0) {
      return this.status(manifest, 'missing', `No managed binary manifest entries are configured for ${manifest.name}.`)
    }

    const entry = this.selectEntry(manifest)
    if (!entry) {
      return this.status(manifest, 'unsupported-platform', `No managed binary is available for ${this.platformKey}.`)
    }

    const binaryPath = this.getBinaryPath(manifest, entry)
    if (!fs.existsSync(binaryPath)) {
      if (await this.hasAnyInstalledVersion(manifest.name, entry.platform)) {
        return this.status(
          manifest,
          'update-available',
          'A managed binary is installed, but not this version.',
          binaryPath
        )
      }

      return this.status(manifest, 'missing', `Managed binary is not installed at ${binaryPath}.`, binaryPath)
    }

    const verification = await this.verifyFile(binaryPath, entry)
    if (!verification.ok) {
      return this.status(manifest, 'verification-failed', verification.message, binaryPath)
    }

    return this.status(manifest, 'installed', `Managed binary is installed at ${binaryPath}.`, binaryPath)
  }

  async resolveInstalledBinary(manifest: ManagedBinaryManifest): Promise<ManagedBinaryResolution> {
    const status = await this.getStatus(manifest)
    return {
      status,
      binaryPath: status.state === 'installed' ? status.binaryPath : undefined
    }
  }

  async install(
    manifest: ManagedBinaryManifest,
    options: ManagedBinaryInstallOptions = {}
  ): Promise<ManagedBinaryStatus> {
    throwIfAborted(options.signal)
    const currentStatus = await this.getStatus(manifest)
    if (currentStatus.state === 'installed') {
      return currentStatus
    }

    if (manifest.binaries.length === 0) {
      return this.status(
        manifest,
        'download-failed',
        `No downloadable managed binary is configured for ${manifest.name}.`
      )
    }

    const entry = this.selectEntry(manifest)
    if (!entry) {
      return this.status(manifest, 'unsupported-platform', `No managed binary is available for ${this.platformKey}.`)
    }

    const sourceUrls = this.resolveDownloadUrls(entry)
    if (sourceUrls.length === 0) {
      return this.status(manifest, 'download-failed', `No downloadable source is configured for ${entry.platform}.`)
    }

    const binaryPath = this.getBinaryPath(manifest, entry)
    const retainedBinaryPath = await this.findAnyInstalledBinaryPath(
      manifest.name,
      manifest.version,
      entry.platform,
      entry.binaryName
    )
    const installDir = path.dirname(binaryPath)
    const tempDir = path.join(this.rootDir, '.tmp')
    const tempPath = path.join(tempDir, `${manifest.name}-${manifest.version}-${entry.platform}-${Date.now()}.download`)

    try {
      await fsAsync.mkdir(tempDir, { recursive: true })
      await fsAsync.mkdir(installDir, { recursive: true })
      options.onProgress?.({
        status: 'running',
        phase: 'downloading',
        message: `Downloading ${manifest.name} ${manifest.version}.`
      })
      await this.download(sourceUrls, tempPath, entry, options)

      throwIfAborted(options.signal)
      options.onProgress?.({
        status: 'running',
        phase: 'verifying',
        message: `Verifying ${manifest.name} ${manifest.version}.`
      })
      const verification = await this.verifyFile(tempPath, entry)
      if (!verification.ok) {
        await removeIfExists(tempPath)
        if (retainedBinaryPath) {
          return this.status(
            manifest,
            'previous-version-retained',
            `${verification.message} Previous verified managed binary was retained at ${retainedBinaryPath}.`,
            retainedBinaryPath
          )
        }
        return this.status(manifest, 'verification-failed', verification.message, binaryPath)
      }

      if (process.platform !== 'win32') {
        await fsAsync.chmod(tempPath, 0o755)
      }

      throwIfAborted(options.signal)
      options.onProgress?.({
        status: 'running',
        phase: 'installing',
        message: `Installing ${manifest.name} ${manifest.version}.`
      })
      await removeIfExists(binaryPath)
      await fsAsync.rename(tempPath, binaryPath)

      options.onProgress?.({
        status: 'completed',
        phase: 'installed',
        progress: 1,
        message: `Installed ${manifest.name} ${manifest.version}.`
      })
      return this.status(manifest, 'installed', `Managed binary is installed at ${binaryPath}.`, binaryPath)
    } catch (error) {
      await removeIfExists(tempPath)
      const aborted = isAbortError(error) || options.signal?.aborted
      logger.warn('Managed binary install failed', {
        name: manifest.name,
        version: manifest.version,
        platform: entry.platform,
        error: error instanceof Error ? error.message : String(error)
      })
      options.onProgress?.({
        status: aborted ? 'cancelled' : 'failed',
        phase: aborted ? 'cancelled' : 'download-failed',
        message: aborted
          ? 'Managed binary install was cancelled.'
          : `Managed binary download failed: ${formatError(error)}`,
        code: aborted ? 'operation_cancelled' : error instanceof TimeoutError ? 'download_timeout' : 'download_failed'
      })
      if (!aborted && retainedBinaryPath) {
        return this.status(
          manifest,
          'previous-version-retained',
          `Managed binary update failed: ${formatError(error)} Previous verified managed binary was retained at ${retainedBinaryPath}.`,
          retainedBinaryPath
        )
      }
      return this.status(
        manifest,
        'download-failed',
        aborted ? 'Managed binary install was cancelled.' : `Managed binary download failed: ${formatError(error)}`,
        binaryPath
      )
    }
  }

  private async download(
    urls: URL[],
    destinationPath: string,
    entry: ManagedBinaryManifestEntry,
    options: ManagedBinaryInstallOptions
  ): Promise<void> {
    let lastError: unknown
    for (const url of urls) {
      throwIfAborted(options.signal)
      const transport = this.transports.find((candidate) => candidate.canDownload(url))
      if (!transport) {
        lastError = new Error(`No managed binary transport supports ${url.protocol}`)
        continue
      }

      try {
        await removeIfExists(destinationPath)
        await transport.download(url, destinationPath, {
          maxSize: entry.maxSize ?? entry.size,
          totalBytes: entry.size,
          signal: options.signal,
          timeoutMs: options.timeoutMs ?? DEFAULT_MANAGED_BINARY_DOWNLOAD_TIMEOUT_MS,
          onProgress: options.onProgress
        })
        return
      } catch (error) {
        lastError = error
        logger.warn('Managed binary transport failed', {
          platform: entry.platform,
          protocol: url.protocol,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Managed binary download failed.')
  }

  private resolveDownloadUrls(entry: ManagedBinaryManifestEntry): URL[] {
    const urls: URL[] = []
    if (entry.ipfsCid) {
      const ipfsPath = entry.ipfsPath ? `/${entry.ipfsPath.replace(/^\/+/, '')}` : ''
      urls.push(new URL(`ipfs://${entry.ipfsCid}${ipfsPath}`))
    }

    if (entry.httpsUrl) {
      try {
        urls.push(new URL(entry.httpsUrl))
      } catch (error) {
        logger.warn('Invalid managed binary URL', {
          platform: entry.platform,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return urls
  }

  private requireEntry(manifest: ManagedBinaryManifest): ManagedBinaryManifestEntry {
    const entry = this.selectEntry(manifest)
    if (!entry) {
      throw new Error(`No managed binary manifest entry exists for ${this.platformKey}.`)
    }

    return entry
  }

  private async verifyFile(
    filePath: string,
    entry: ManagedBinaryManifestEntry
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const stats = await fsAsync.stat(filePath)
    if (entry.maxSize && stats.size > entry.maxSize) {
      return {
        ok: false,
        message: `Managed binary exceeds max size at ${filePath}: max ${entry.maxSize}, got ${stats.size}.`
      }
    }

    if (stats.size !== entry.size) {
      return {
        ok: false,
        message: `Managed binary size mismatch at ${filePath}: expected ${entry.size}, got ${stats.size}.`
      }
    }

    const sha256 = await sha256File(filePath)
    if (sha256 !== entry.sha256) {
      return {
        ok: false,
        message: `Managed binary SHA-256 mismatch at ${filePath}: expected ${entry.sha256}, got ${sha256}.`
      }
    }

    return { ok: true }
  }

  private async hasAnyInstalledVersion(name: string, platform: string): Promise<boolean> {
    const binaryRoot = path.join(this.rootDir, sanitizePathSegment(name))
    const entries = await fsAsync.readdir(binaryRoot, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const platformDir = path.join(binaryRoot, entry.name, platform)
      const platformEntries = await fsAsync.readdir(platformDir, { withFileTypes: true }).catch(() => [])
      if (platformEntries.some((candidate) => candidate.isFile())) {
        return true
      }
    }

    return false
  }

  private async findAnyInstalledBinaryPath(
    name: string,
    currentVersion: string,
    platform: string,
    binaryName: string
  ): Promise<string | undefined> {
    const binaryRoot = path.join(this.rootDir, sanitizePathSegment(name))
    const entries = await fsAsync.readdir(binaryRoot, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === sanitizePathSegment(currentVersion)) {
        continue
      }

      const candidatePath = path.join(binaryRoot, entry.name, platform, binaryName)
      if (fs.existsSync(candidatePath)) {
        return candidatePath
      }
    }

    return undefined
  }

  private status(
    manifest: ManagedBinaryManifest,
    state: ManagedBinaryStatusState,
    message: string,
    binaryPath?: string
  ): ManagedBinaryStatus {
    return {
      name: manifest.name,
      version: manifest.version,
      platform: this.platformKey,
      state,
      binaryPath,
      message
    }
  }
}

export class FileManagedBinaryTransport implements ManagedBinaryTransport {
  canDownload(url: URL): boolean {
    return url.protocol === 'file:'
  }

  async download(url: URL, destinationPath: string, options: ManagedBinaryDownloadOptions = {}): Promise<void> {
    throwIfAborted(options.signal)
    const sourcePath = fileURLToPath(url)
    const stats = await fsAsync.stat(sourcePath)
    assertMaxSize(stats.size, options.maxSize, url.toString())
    options.onProgress?.({
      status: 'running',
      phase: 'downloading',
      receivedBytes: 0,
      totalBytes: stats.size,
      progress: 0,
      message: `Copying managed binary from ${sourcePath}.`
    })
    await fsAsync.copyFile(sourcePath, destinationPath)
    throwIfAborted(options.signal)
    options.onProgress?.({
      status: 'running',
      phase: 'downloading',
      receivedBytes: stats.size,
      totalBytes: stats.size,
      progress: 1,
      message: `Copied managed binary from ${sourcePath}.`
    })
  }
}

export class HttpsManagedBinaryTransport implements ManagedBinaryTransport {
  constructor(private readonly retries = 2) {}

  canDownload(url: URL): boolean {
    return url.protocol === 'https:'
  }

  async download(url: URL, destinationPath: string, options: ManagedBinaryDownloadOptions = {}): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        await this.downloadOnce(url, destinationPath, options)
        return
      } catch (error) {
        lastError = error
        await removeIfExists(destinationPath)
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Failed to download ${url.toString()}.`)
  }

  private async downloadOnce(url: URL, destinationPath: string, options: ManagedBinaryDownloadOptions): Promise<void> {
    const { signal, dispose } = createTimeoutSignal(options.signal, options.timeoutMs)
    try {
      throwIfAborted(signal)
      const response = await fetch(url, { signal })
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} while downloading managed binary.`)
      }

      const contentLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(contentLength) && contentLength > 0) {
        assertMaxSize(contentLength, options.maxSize, url.toString())
      }

      const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : options.totalBytes
      await pipeline(
        Readable.fromWeb(response.body as any),
        createMaxSizeTransform(options.maxSize, url.toString(), totalBytes, options.onProgress),
        fs.createWriteStream(destinationPath),
        { signal }
      )
    } catch (error) {
      if (isAbortError(error) && !options.signal?.aborted) {
        throw new TimeoutError(`Timed out downloading managed binary from ${url.toString()}.`)
      }
      throw error
    } finally {
      dispose()
    }
  }
}

export class IpfsGatewayTransport implements ManagedBinaryTransport {
  constructor(
    private readonly gateways = [
      process.env.THE_BOSS_IPFS_GATEWAY_URL ?? 'https://ipfs.prometheusags.ai/ipfs/',
      'https://ipfs.io/ipfs/',
      'https://cloudflare-ipfs.com/ipfs/'
    ],
    private readonly httpsTransport: ManagedBinaryTransport = new HttpsManagedBinaryTransport()
  ) {}

  canDownload(url: URL): boolean {
    return url.protocol === 'ipfs:'
  }

  async download(url: URL, destinationPath: string, options: ManagedBinaryDownloadOptions = {}): Promise<void> {
    const cid = url.hostname
    if (!cid) {
      throw new Error('IPFS CID is required for managed binary download.')
    }

    let lastError: unknown
    for (const gateway of this.gateways) {
      try {
        await this.httpsTransport.download(resolveIpfsGatewayUrl(gateway, cid, url.pathname), destinationPath, options)
        return
      } catch (error) {
        lastError = error
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Failed to download IPFS CID ${cid}.`)
  }
}

let managedBinaryServiceInstance: ManagedBinaryService | undefined

export function getManagedBinaryService(): ManagedBinaryService {
  managedBinaryServiceInstance ??= new ManagedBinaryService()
  return managedBinaryServiceInstance
}

function getCurrentPlatformKey(): string {
  return `${process.platform}-${process.arch}`
}

function sanitizePathSegment(segment: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
    throw new Error(`Invalid managed binary path segment: ${segment}`)
  }

  return segment
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(fs.createReadStream(filePath), hash)
  return hash.digest('hex')
}

async function removeIfExists(filePath: string): Promise<void> {
  await fsAsync.rm(filePath, { force: true })
}

function assertMaxSize(size: number, maxSize: number | undefined, label: string): void {
  if (maxSize && size > maxSize) {
    throw new Error(`Managed binary ${label} exceeds max size ${maxSize}; got ${size}.`)
  }
}

function createMaxSizeTransform(
  maxSize: number | undefined,
  label: string,
  totalBytes?: number,
  onProgress?: ManagedBinaryInstallOptions['onProgress']
): Transform {
  let bytes = 0
  return new Transform({
    transform(chunk, _encoding, callback) {
      bytes += Buffer.byteLength(chunk)
      try {
        assertMaxSize(bytes, maxSize, label)
        onProgress?.({
          status: 'running',
          phase: 'downloading',
          receivedBytes: bytes,
          totalBytes,
          progress: totalBytes && totalBytes > 0 ? Math.min(bytes / totalBytes, 1) : undefined,
          message: `Downloading managed binary from ${label}.`
        })
        callback(null, chunk)
      } catch (error) {
        callback(error as Error)
      }
    }
  })
}

function resolveIpfsGatewayUrl(gateway: string, cid: string, pathname: string): URL {
  const base = gateway.endsWith('/') ? gateway : `${gateway}/`
  const cleanPathname = pathname.replace(/^\/+/, '')
  return new URL(`${cid}${cleanPathname ? `/${cleanPathname}` : ''}`, base)
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Operation cancelled.')
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted')))
  )
}

function createTimeoutSignal(
  parentSignal?: AbortSignal,
  timeoutMs?: number
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  let timeout: NodeJS.Timeout | undefined
  let parentAbortListener: (() => void) | undefined

  const abort = (reason?: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(reason)
    }
  }

  if (parentSignal) {
    if (parentSignal.aborted) {
      abort(parentSignal.reason)
    } else {
      parentAbortListener = () => abort(parentSignal.reason)
      parentSignal.addEventListener('abort', parentAbortListener, { once: true })
    }
  }

  if (timeoutMs && timeoutMs > 0) {
    timeout = setTimeout(() => abort(new TimeoutError('Managed binary download timed out.')), timeoutMs)
  }

  return {
    signal: controller.signal,
    dispose: () => {
      if (timeout) {
        clearTimeout(timeout)
      }
      if (parentSignal && parentAbortListener) {
        parentSignal.removeEventListener('abort', parentAbortListener)
      }
    }
  }
}
