import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import fsAsync from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'

import { loggerService } from '@logger'
import { getDataPath, getResourcePath, toAsarUnpackedPath } from '@main/utils'
import type { AgentRuntimeConfig } from '@types'
import { app } from 'electron'

import {
  getManagedBinaryService,
  type ManagedBinaryManifest,
  type ManagedBinaryResolution,
  type ManagedBinaryStatus
} from './ManagedBinaryService'

const logger = loggerService.withContext('UniversalAgentRuntimeService')

export const UAR_EXPECTED_COMMIT = 'c7c8416b94d39358ec7cf03691738426c25b2df8'
const UAR_BINARY_NAME = 'universal-agent-runtime'
const UAR_READY_TIMEOUT_MS = 30_000
const UAR_READY_POLL_MS = 500

export const UAR_MANAGED_BINARY_MANIFEST: ManagedBinaryManifest = {
  name: 'universal-agent-runtime',
  version: UAR_EXPECTED_COMMIT,
  sourceCommit: UAR_EXPECTED_COMMIT,
  supportedPlatforms: ['darwin-arm64'],
  binaries: [
    {
      platform: 'darwin-arm64',
      binaryName: UAR_BINARY_NAME,
      size: 126_157_280,
      sha256: '183ef62349420738b0d3e65fb7b9be308001b626da1542c1d378f8c198ce3d63'
    }
  ]
}

export interface UarProviderRuntimeOptions {
  providerId?: string
  apiKey?: string
  apiHost?: string
  modelId?: string
}

interface RunningSidecar {
  endpoint: string
  configPath: string
  process: ChildProcess
  binaryPath: string
  binarySource: UarBinarySource
}

export type UarSidecarState =
  | 'missing-binary'
  | 'not-installed'
  | 'starting'
  | 'ready'
  | 'not-ready'
  | 'stopped'
  | 'downloading'
  | 'verifying'
  | 'installed'
  | 'update-available'
  | 'verification-failed'
  | 'download-failed'
  | 'unsupported-platform'

export type UarBinarySource = 'configured' | 'environment' | 'managed' | 'bundled'

export interface UarSidecarStatus {
  kind: 'uar'
  state: UarSidecarState
  endpoint?: string
  binaryPath?: string
  binarySource?: UarBinarySource
  configPath?: string
  message: string
}

interface UarNativeToolsConfig {
  fileToolsEnabled: boolean
  webFetchEnabled: boolean
  terminalExecEnabled: boolean
}

type ManagedBinaryServiceLike = {
  resolveInstalledBinary(manifest: ManagedBinaryManifest): Promise<ManagedBinaryResolution>
  install?(manifest: ManagedBinaryManifest): Promise<ManagedBinaryStatus>
}

interface UniversalAgentRuntimeServiceDependencies {
  managedBinaryService?: ManagedBinaryServiceLike
  managedBinaryManifest?: ManagedBinaryManifest
}

interface UarBinaryResolution {
  binaryPath?: string
  binarySource?: UarBinarySource
  blockingStatus?: UarSidecarStatus
}

export class UniversalAgentRuntimeService {
  private running?: RunningSidecar
  private starting?: Promise<RunningSidecar>
  private readonly managedBinaryService?: ManagedBinaryServiceLike
  private readonly managedBinaryManifest: ManagedBinaryManifest

  constructor(dependencies: UniversalAgentRuntimeServiceDependencies = {}) {
    this.managedBinaryService = dependencies.managedBinaryService
    this.managedBinaryManifest = dependencies.managedBinaryManifest ?? UAR_MANAGED_BINARY_MANIFEST
    app.once('before-quit', () => {
      void this.stop()
    })
  }

  async ensureRunning(
    runtimeConfig: AgentRuntimeConfig,
    providerOptions: UarProviderRuntimeOptions = {}
  ): Promise<string> {
    if (this.running && !this.running.process.killed) {
      return this.running.endpoint
    }

    if (!this.starting) {
      this.starting = this.start(runtimeConfig, providerOptions).finally(() => {
        this.starting = undefined
      })
    }

    const running = await this.starting
    return running.endpoint
  }

  async getStatus(runtimeConfig: AgentRuntimeConfig): Promise<UarSidecarStatus> {
    if (runtimeConfig.mode === 'remote') {
      const endpoint = readString(runtimeConfig.endpoint)
      if (!endpoint) {
        return {
          kind: 'uar',
          state: 'stopped',
          message: 'UAR remote endpoint is not configured.'
        }
      }

      const ready = (await isHealthy(endpoint, '/healthz')) && (await isHealthy(endpoint, '/readyz'))
      return {
        kind: 'uar',
        state: ready ? 'ready' : 'not-ready',
        endpoint,
        message: ready ? 'UAR remote endpoint is ready.' : 'UAR remote endpoint is reachable but not ready.'
      }
    }

    const resolution = await this.resolveBinary(runtimeConfig)
    if (resolution.blockingStatus) {
      return resolution.blockingStatus
    }

    if (!resolution.binaryPath || !fs.existsSync(resolution.binaryPath)) {
      return {
        kind: 'uar',
        state: 'not-installed',
        binaryPath: resolution.binaryPath,
        binarySource: resolution.binarySource,
        message: resolution.binaryPath
          ? `UAR embedded sidecar binary is missing at ${resolution.binaryPath}.`
          : 'UAR embedded sidecar binary is not installed.'
      }
    }

    if (this.starting) {
      return {
        kind: 'uar',
        state: 'starting',
        binaryPath: resolution.binaryPath,
        binarySource: resolution.binarySource,
        message: 'UAR embedded sidecar is starting.'
      }
    }

    if (!this.running || this.running.process.killed) {
      return {
        kind: 'uar',
        state: 'stopped',
        binaryPath: resolution.binaryPath,
        binarySource: resolution.binarySource,
        message: 'UAR embedded sidecar is stopped.'
      }
    }

    const ready =
      (await isHealthy(this.running.endpoint, '/healthz')) && (await isHealthy(this.running.endpoint, '/readyz'))
    return {
      kind: 'uar',
      state: ready ? 'ready' : 'not-ready',
      endpoint: this.running.endpoint,
      binaryPath: this.running.binaryPath,
      binarySource: this.running.binarySource,
      configPath: this.running.configPath,
      message: ready ? 'UAR embedded sidecar is ready.' : 'UAR embedded sidecar is running but not ready.'
    }
  }

  async installManagedBinary(): Promise<UarSidecarStatus> {
    const managedBinaryService = this.managedBinaryService ?? getManagedBinaryService()
    if (!managedBinaryService.install) {
      return {
        kind: 'uar',
        state: 'download-failed',
        binarySource: 'managed',
        message: 'Managed UAR binary install is not available.'
      }
    }

    return mapManagedBinaryStatus(await managedBinaryService.install(this.managedBinaryManifest))
  }

  async stop(): Promise<void> {
    const running = this.running
    this.running = undefined

    if (!running || running.process.killed) {
      return
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        running.process.kill('SIGKILL')
        resolve()
      }, 3000)

      running.process.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })

      running.process.kill()
    })
  }

  private async start(
    runtimeConfig: AgentRuntimeConfig,
    providerOptions: UarProviderRuntimeOptions
  ): Promise<RunningSidecar> {
    const resolution = await this.resolveBinary(runtimeConfig)
    const binaryPath = resolution.binaryPath
    if (resolution.blockingStatus) {
      throw new Error(resolution.blockingStatus.message)
    }

    if (!binaryPath || !fs.existsSync(binaryPath)) {
      throw new Error(
        `UAR embedded sidecar binary is missing at ${binaryPath ?? 'managed app data'}. Run pnpm uar:build:sidecar or install a verified managed UAR binary before using embedded UAR.`
      )
    }

    const sidecar = getSidecarConfig(runtimeConfig)
    const port = readPort(sidecar.port) ?? (await allocateLoopbackPort())
    const grpcPort = readPort(sidecar.grpcPort) ?? (await allocateLoopbackPort())
    const dataDir = readString(sidecar.dataDir) ?? getDataPath('uar')
    const rocksDbPath = readString(sidecar.rocksDbPath) ?? path.join(dataDir, 'rocksdb')
    const uploadsPath = readString(sidecar.uploadsPath) ?? path.join(dataDir, 'uploads')
    const configPath = path.join(dataDir, 'config.generated.yaml')
    const endpoint = `http://127.0.0.1:${port}`
    const nativeTools = readNativeToolsConfig(sidecar.nativeTools)
    const logLevel = readString(sidecar.logLevel) ?? 'info'

    await fsAsync.mkdir(rocksDbPath, { recursive: true })
    await fsAsync.mkdir(uploadsPath, { recursive: true })
    await fsAsync.writeFile(
      configPath,
      buildUarConfig({
        port,
        grpcPort,
        rocksDbPath,
        uploadsPath,
        providerOptions,
        nativeTools
      })
    )

    const child = spawn(binaryPath, ['--config', configPath], {
      cwd: dataDir,
      env: {
        ...process.env,
        CONFIG_FILE: configPath,
        LLM_API_KEY: providerOptions.apiKey ?? process.env.LLM_API_KEY ?? '',
        LLM_MODEL: providerOptions.modelId ?? process.env.LLM_MODEL ?? '',
        LLM_BASE_URL: providerOptions.apiHost ?? process.env.LLM_BASE_URL ?? '',
        RUST_LOG: logLevel,
        UAR_NATIVE_TOOLS__FILE_TOOLS_ENABLED: String(nativeTools.fileToolsEnabled),
        UAR_NATIVE_TOOLS__WEB_FETCH_ENABLED: String(nativeTools.webFetchEnabled),
        UAR_NATIVE_TOOLS__TERMINAL_EXEC_ENABLED: String(nativeTools.terminalExecEnabled),
        UAR_SKILL_EVOLUTION__ENABLED: 'false'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    child.stdout?.on('data', (data) => {
      logger.debug('UAR sidecar stdout', { line: redact(String(data)).trim().slice(0, 500) })
    })
    child.stderr?.on('data', (data) => {
      logger.warn('UAR sidecar stderr', { line: redact(String(data)).trim().slice(0, 500) })
    })
    child.once('exit', (code, signal) => {
      logger.info('UAR sidecar exited', { code, signal })
      if (this.running?.process === child) {
        this.running = undefined
      }
    })

    const running: RunningSidecar = {
      endpoint,
      configPath,
      process: child,
      binaryPath,
      binarySource: resolution.binarySource ?? 'bundled'
    }

    try {
      await waitForUarReady(endpoint, child)
      this.running = running
      logger.info('UAR sidecar ready', { endpoint, configPath, binaryPath, binarySource: running.binarySource })
      return running
    } catch (error) {
      child.kill()
      throw error
    }
  }

  private async resolveBinary(runtimeConfig: AgentRuntimeConfig): Promise<UarBinaryResolution> {
    const sidecar = getSidecarConfig(runtimeConfig)
    const configuredPath = typeof sidecar.binaryPath === 'string' ? sidecar.binaryPath : undefined
    const envPath = process.env.UAR_SIDECAR_PATH
    if (configuredPath) {
      return { binaryPath: configuredPath, binarySource: 'configured' }
    }
    if (envPath) {
      return { binaryPath: envPath, binarySource: 'environment' }
    }

    const managedBinaryService = this.managedBinaryService ?? getManagedBinaryService()
    const managed = await managedBinaryService.resolveInstalledBinary(this.managedBinaryManifest)
    if (managed.binaryPath) {
      return { binaryPath: managed.binaryPath, binarySource: 'managed' }
    }
    if (managed.status.state === 'verification-failed' || managed.status.state === 'download-failed') {
      return {
        blockingStatus: mapManagedBinaryStatus(managed.status)
      }
    }

    const bundledPath = toAsarUnpackedPath(
      path.join(getResourcePath(), 'binaries', getUarPlatformKey(), getUarBinaryName())
    )
    if (fs.existsSync(bundledPath)) {
      return { binaryPath: bundledPath, binarySource: 'bundled' }
    }

    if (managed.status.state !== 'missing') {
      return {
        binaryPath: managed.status.binaryPath,
        binarySource: 'managed',
        blockingStatus: mapManagedBinaryStatus(managed.status)
      }
    }

    return { binaryPath: bundledPath, binarySource: 'bundled' }
  }
}

function mapManagedBinaryStatus(status: ManagedBinaryStatus): UarSidecarStatus {
  const stateMap: Record<ManagedBinaryStatus['state'], UarSidecarState> = {
    missing: 'not-installed',
    installed: 'installed',
    verifying: 'verifying',
    'verification-failed': 'verification-failed',
    downloading: 'downloading',
    'download-failed': 'download-failed',
    'unsupported-platform': 'unsupported-platform',
    'update-available': 'update-available'
  }

  return {
    kind: 'uar',
    state: stateMap[status.state],
    binaryPath: status.binaryPath,
    binarySource: 'managed',
    message: status.message
  }
}

function buildUarConfig({
  port,
  grpcPort,
  rocksDbPath,
  uploadsPath,
  providerOptions,
  nativeTools
}: {
  port: number
  grpcPort: number
  rocksDbPath: string
  uploadsPath: string
  providerOptions: UarProviderRuntimeOptions
  nativeTools: UarNativeToolsConfig
}): string {
  const providerId = providerOptions.providerId || 'openai'
  const defaultModel = providerOptions.modelId || 'gpt-5.2'
  const baseUrl = providerOptions.apiHost || 'https://api.openai.com'

  return `# Generated by The Boss. Do not edit while the app is running.
server:
  port: ${port}
  host: "127.0.0.1"
  grpc_port: ${grpcPort}

security:
  jwt_required: false
  jwt_secret: "the-boss-uar-local-sidecar-secret"

resilience:
  rate_limit_enabled: false
  timeout_disabled: true
  requests_per_second: 100.0
  burst_size: 200.0

persistence:
  provider: "surreal"
  database_url: ${yamlString(`rocksdb://${rocksDbPath}`)}
  external_cache_enabled: false
  vector_dimension: 384

file_processing:
  provider: "auto"
  upload_dir: ${yamlString(uploadsPath)}
  max_files_per_prompt: 10
  max_file_size: 52428800
  max_total_size: 104857600

providers:
  - id: ${yamlString(providerId)}
    display_name: ${yamlString(providerId)}
    base_url: ${yamlString(baseUrl)}
    api_key: "\${LLM_API_KEY}"
    protocol: "auto"
    enabled: true
    default_model: ${yamlString(defaultModel)}

native_tools:
  file_tools_enabled: ${nativeTools.fileToolsEnabled}
  file_allowed_paths: []
  web_fetch_enabled: ${nativeTools.webFetchEnabled}
  terminal_exec_enabled: ${nativeTools.terminalExecEnabled}
  session_search_enabled: true

skill_evolution:
  enabled: false

acp:
  enabled: false
`
}

function getUarPlatformKey(): string {
  return `${process.platform}-${process.arch}`
}

function getUarBinaryName(): string {
  return process.platform === 'win32' ? `${UAR_BINARY_NAME}.exe` : UAR_BINARY_NAME
}

function getSidecarConfig(runtimeConfig: AgentRuntimeConfig): Record<string, unknown> {
  return runtimeConfig.sidecar && typeof runtimeConfig.sidecar === 'object' ? runtimeConfig.sidecar : {}
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readPort(value: unknown): number | undefined {
  const port = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : undefined
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
    return undefined
  }
  return port
}

function readNativeToolsConfig(value: unknown): UarNativeToolsConfig {
  const nativeTools = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    fileToolsEnabled: nativeTools.fileToolsEnabled === true,
    webFetchEnabled: nativeTools.webFetchEnabled === true,
    terminalExecEnabled: nativeTools.terminalExecEnabled === true
  }
}

function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address?.port) {
          resolve(address.port)
        } else {
          reject(new Error('Failed to allocate loopback port for UAR sidecar'))
        }
      })
    })
  })
}

async function waitForUarReady(endpoint: string, child: ChildProcess): Promise<void> {
  const startedAt = Date.now()
  let earlyExit: string | undefined
  child.once('exit', (code, signal) => {
    earlyExit = `UAR sidecar exited before readiness with code ${code ?? 'null'} and signal ${signal ?? 'null'}`
  })

  while (Date.now() - startedAt < UAR_READY_TIMEOUT_MS) {
    if (earlyExit) {
      throw new Error(earlyExit)
    }

    if ((await isHealthy(endpoint, '/healthz')) && (await isHealthy(endpoint, '/readyz'))) {
      return
    }

    await delay(UAR_READY_POLL_MS)
  }

  throw new Error(`Timed out waiting for UAR sidecar readiness at ${endpoint}`)
}

async function isHealthy(endpoint: string, pathName: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1000)
    const response = await fetch(new URL(pathName, endpoint), { signal: controller.signal })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function redact(value: string): string {
  return value.replace(/(api[_-]?key|authorization|token|secret)(["':=\s]+)([^"',\s]+)/gi, '$1$2[redacted]')
}

export const universalAgentRuntimeService = new UniversalAgentRuntimeService()
