import { type ChildProcess, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as fsAsync from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { getAvailableProviders } from '@main/apiServer/utils'
import { toAsarUnpackedPath } from '@main/utils'
import type * as OpenCodeSdk from '@opencode-ai/sdk'
import type { AgentRuntimeConfig, Provider } from '@types'
import { app } from 'electron'
import { parse as parseJsonc } from 'jsonc-parser'

const logger = loggerService.withContext('OpenCodeCliService')
const SERVER_START_TIMEOUT_MS = 10_000
const MODEL_LIST_CACHE_TTL = 60 * 1000

type OpenCodeClient = any
type OpenCodeModule = typeof OpenCodeSdk
type SpawnOpenCodeProcess = (command: string, args: string[], options: Parameters<typeof spawn>[2]) => ChildProcess

export interface OpenCodeBinaryResolution {
  path?: string
  source?: 'configured' | 'packaged' | 'development'
  state: 'ready' | 'missing-binary' | 'unsupported-platform'
  message: string
}

export interface OpenCodeRuntimeModel {
  id: string
  providerId: string
  modelId: string
  displayName: string
  providerName: string
  hidden: boolean
  isDefault: boolean
  capabilities: Record<string, unknown>
  defaultAgent?: string
}

interface ManagedOpenCodeServer {
  key: string
  url: string
  process: ChildProcess
  client: OpenCodeClient
}

interface OpenCodeConfigFileState {
  exists: boolean
  usable: boolean
  path?: string
}

interface OpenCodeCliServiceDependencies {
  spawnProcess?: SpawnOpenCodeProcess
  appPath?: () => string
  homedir?: () => string
  developmentBinaryPath?: (platform: NonNullable<ReturnType<typeof getOpenCodePlatform>>) => string | undefined
  loadSdk?: () => Promise<OpenCodeModule>
  getAvailableProviders?: () => Promise<Provider[]>
}

export class OpenCodeCliService {
  private readonly spawnProcess: SpawnOpenCodeProcess
  private readonly appPath: () => string
  private readonly homedir: () => string
  private readonly developmentBinaryPath: (
    platform: NonNullable<ReturnType<typeof getOpenCodePlatform>>
  ) => string | undefined
  private readonly loadSdk: () => Promise<OpenCodeModule>
  private readonly getAvailableProviders: () => Promise<Provider[]>
  private readonly servers = new Map<string, Promise<ManagedOpenCodeServer>>()
  private modelCache: { key: string; expiresAt: number; models: OpenCodeRuntimeModel[] } | null = null

  constructor(dependencies: OpenCodeCliServiceDependencies = {}) {
    this.spawnProcess = dependencies.spawnProcess ?? ((command, args, options) => spawn(command, args, options))
    this.appPath = dependencies.appPath ?? (() => app.getAppPath())
    this.homedir = dependencies.homedir ?? (() => os.homedir())
    this.developmentBinaryPath = dependencies.developmentBinaryPath ?? resolveDevelopmentOpenCodeBinary
    this.loadSdk = dependencies.loadSdk ?? (() => import('@opencode-ai/sdk'))
    this.getAvailableProviders = dependencies.getAvailableProviders ?? getAvailableProviders
    app.once('before-quit', () => {
      void this.dispose()
    })
  }

  resolveBinary(runtimeConfig?: AgentRuntimeConfig): OpenCodeBinaryResolution {
    const platform = getOpenCodePlatform()
    if (!platform) {
      return {
        state: 'unsupported-platform',
        message: `OpenCode runtime is not supported on ${process.platform}/${process.arch}.`
      }
    }

    const configuredPath = readConfiguredOpenCodePath(runtimeConfig)
    if (configuredPath) {
      const configured = this.validateCandidate(configuredPath, 'configured')
      if (configured) {
        return configured
      }
    }

    const packagedPath = path.join(this.appPath(), 'resources', 'opencode', platform.resourceDir, platform.binaryName)
    const packaged = this.validateCandidate(remapAsarResourcePath(packagedPath, this.appPath()), 'packaged')
    if (packaged) {
      return packaged
    }

    const developmentPath = this.developmentBinaryPath(platform)
    if (developmentPath) {
      const development = this.validateCandidate(developmentPath, 'development')
      if (development) {
        return development
      }
    }

    return {
      state: 'missing-binary',
      message:
        configuredPath && !fs.existsSync(configuredPath)
          ? `Configured OpenCode executable does not exist: ${configuredPath}`
          : 'OpenCode executable was not found. Build the embedded OpenCode runtime or ensure resources/opencode is packaged outside app.asar.'
    }
  }

  async resolveClient(
    runtimeConfig: AgentRuntimeConfig,
    cwd: string,
    config: Record<string, unknown> = {}
  ): Promise<OpenCodeClient> {
    const sdk = await this.loadSdk()
    if (runtimeConfig.mode === 'remote') {
      if (!runtimeConfig.endpoint) {
        throw new Error('OpenCode remote runtime requires a configured endpoint')
      }
      return sdk.createOpencodeClient(
        removeUndefinedValues({
          baseUrl: runtimeConfig.endpoint,
          directory: cwd,
          headers: resolveOpenCodeAuthHeaders(runtimeConfig.authRef)
        })
      )
    }

    await this.ensureGlobalConfigFromCherryProviders()
    const key = `${cwd}:${JSON.stringify(config)}`
    if (!this.servers.has(key)) {
      this.servers.set(key, this.startManagedServer(runtimeConfig, cwd, config, sdk))
    }
    return (await this.servers.get(key)!).client
  }

  async listModels(runtimeConfig?: AgentRuntimeConfig, cwd = process.cwd()): Promise<OpenCodeRuntimeModel[]> {
    const cacheKey = `${cwd}:${runtimeConfig?.kind ?? 'opencode'}:${runtimeConfig?.mode ?? 'managed'}:${runtimeConfig?.endpoint ?? ''}`
    if (this.modelCache && this.modelCache.key === cacheKey && this.modelCache.expiresAt > Date.now()) {
      return this.modelCache.models
    }

    const config = normalizeRuntimeConfig(runtimeConfig)
    const client = await this.resolveClient(config, cwd)
    const [configResponse, providersResponse] = await Promise.all([
      callOpenCodeConfigGet(client, cwd),
      callOpenCodeProviders(client, cwd)
    ])
    const models = normalizeOpenCodeModels(configResponse, providersResponse)
    this.modelCache = {
      key: cacheKey,
      expiresAt: Date.now() + MODEL_LIST_CACHE_TTL,
      models
    }
    return models
  }

  clearModelCache(): void {
    this.modelCache = null
  }

  async dispose(): Promise<void> {
    const entries = await Promise.allSettled(this.servers.values())
    this.servers.clear()
    for (const entry of entries) {
      if (entry.status === 'fulfilled') {
        stopProcess(entry.value.process)
      }
    }
  }

  private validateCandidate(
    candidatePath: string,
    source: OpenCodeBinaryResolution['source']
  ): OpenCodeBinaryResolution | null {
    if (!fs.existsSync(candidatePath)) {
      return null
    }

    const stat = fs.statSync(candidatePath)
    if (!stat.isFile()) {
      return null
    }

    return {
      path: candidatePath,
      source,
      state: 'ready',
      message: `OpenCode executable resolved from ${source}.`
    }
  }

  private async startManagedServer(
    runtimeConfig: AgentRuntimeConfig,
    cwd: string,
    config: Record<string, unknown>,
    sdk: OpenCodeModule
  ): Promise<ManagedOpenCodeServer> {
    const resolution = this.resolveBinary(runtimeConfig)
    if (!resolution.path) {
      throw new Error(resolution.message)
    }

    const child = this.spawnProcess(resolution.path, ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
      cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config)
      }
    })

    const url = await waitForOpenCodeServerUrl(child)
    return {
      key: `${cwd}:${JSON.stringify(config)}`,
      url,
      process: child,
      client: sdk.createOpencodeClient({ baseUrl: url })
    }
  }

  private async ensureGlobalConfigFromCherryProviders(): Promise<void> {
    const existing = await this.readGlobalConfigState()
    if (existing.usable) {
      return
    }

    const providers = await this.getAvailableProviders()
    const config = buildOpenCodeGlobalConfigFromCherryProviders(providers)
    if (!config) {
      return
    }

    const configPath = existing.path ?? path.join(this.homedir(), '.config', 'opencode', 'opencode.json')
    await fsAsync.mkdir(path.dirname(configPath), { recursive: true })
    await fsAsync.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    this.clearModelCache()
  }

  private async readGlobalConfigState(): Promise<OpenCodeConfigFileState> {
    const dir = path.join(this.homedir(), '.config', 'opencode')
    const candidates = ['opencode.json', 'opencode.jsonc', 'config.json'].map((name) => path.join(dir, name))
    for (const candidate of candidates) {
      try {
        const source = await fsAsync.readFile(candidate, 'utf8')
        const config = parseJsonc(source) as Record<string, unknown> | undefined
        return {
          exists: true,
          usable: hasUsableOpenCodeProviderConfig(config),
          path: candidate
        }
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          logger.warn('Failed to read OpenCode config', {
            path: candidate,
            error: error instanceof Error ? error.message : String(error)
          })
          return {
            exists: true,
            usable: false,
            path: candidate
          }
        }
      }
    }

    return {
      exists: false,
      usable: false,
      path: candidates[0]
    }
  }
}

export const openCodeCliService = new OpenCodeCliService()

export function normalizeOpenCodeModels(configResponse: unknown, providersResponse: unknown): OpenCodeRuntimeModel[] {
  const config = readResponseData(configResponse)
  const providerData = readResponseData(providersResponse)
  const configuredDefault = readString((config as any)?.model)
  const providerDefaults = asRecord((providerData as any)?.default)
  const providers = Array.isArray((providerData as any)?.providers) ? (providerData as any).providers : []
  const models: OpenCodeRuntimeModel[] = []

  for (const provider of providers) {
    const providerId = readString(provider?.id)
    if (!providerId) {
      continue
    }

    const providerName = readString(provider?.name) ?? providerId
    const providerDefault = readString(providerDefaults?.[providerId])
    const providerModels = asRecord(provider?.models)
    for (const [fallbackModelId, model] of Object.entries(providerModels ?? {})) {
      const modelId = readString(model?.id) ?? fallbackModelId
      if (!modelId) {
        continue
      }

      const id = `${providerId}/${modelId}`
      const displayName = readString(model?.name) ?? modelId
      models.push({
        id,
        providerId,
        modelId,
        displayName,
        providerName,
        hidden: Boolean(model?.hidden) || model?.status === 'deprecated',
        isDefault: configuredDefault === id || (!configuredDefault && providerDefault === modelId),
        capabilities: asRecord(model?.capabilities) ?? {},
        defaultAgent: readString(model?.defaultAgent)
      })
    }
  }

  if (!models.some((model) => model.isDefault) && models.length > 0) {
    models[0] = { ...models[0], isDefault: true }
  }

  return models
}

export function buildOpenCodeGlobalConfigFromCherryProviders(providers: Provider[]): Record<string, unknown> | null {
  const providerConfig: Record<string, unknown> = {}
  let defaultModel: string | undefined

  for (const provider of providers) {
    if (!provider.enabled || !provider.models?.length) {
      continue
    }

    const providerId = sanitizeOpenCodeId(provider.id)
    const mapped = mapCherryProviderToOpenCodeProvider(provider)
    if (!mapped) {
      continue
    }

    const models: Record<string, unknown> = {}
    for (const model of provider.models) {
      if (!model.id) {
        continue
      }
      models[model.id] = removeUndefinedValues({
        name: model.name || model.id
      })
      defaultModel ??= `${providerId}/${model.id}`
    }

    if (Object.keys(models).length === 0) {
      continue
    }

    providerConfig[providerId] = removeUndefinedValues({
      id: providerId,
      name: provider.name,
      npm: mapped.npm,
      models,
      options: removeUndefinedValues({
        apiKey: provider.apiKey,
        baseURL: mapped.baseURL
      })
    })
  }

  if (!defaultModel || Object.keys(providerConfig).length === 0) {
    return null
  }

  return {
    $schema: 'https://opencode.ai/config.json',
    provider: providerConfig,
    model: defaultModel
  }
}

function mapCherryProviderToOpenCodeProvider(provider: Provider): { npm: string; baseURL?: string } | null {
  if (provider.type === 'anthropic') {
    return {
      npm: '@ai-sdk/anthropic',
      baseURL: provider.anthropicApiHost || provider.apiHost || undefined
    }
  }

  if (provider.type === 'openai') {
    return {
      npm: '@ai-sdk/openai',
      baseURL: provider.apiHost || undefined
    }
  }

  if (provider.type === 'openai-response' || provider.type === 'new-api' || provider.type === 'ollama') {
    return {
      npm: '@ai-sdk/openai-compatible',
      baseURL: provider.apiHost || undefined
    }
  }

  return null
}

function hasUsableOpenCodeProviderConfig(config: Record<string, unknown> | undefined): boolean {
  if (!config || typeof config !== 'object') {
    return false
  }
  if (readString(config.model)) {
    return true
  }

  const providers = asRecord(config.provider)
  if (!providers) {
    return false
  }

  return Object.values(providers).some((provider) => {
    const models = asRecord(provider?.models)
    return models && Object.keys(models).length > 0
  })
}

function getOpenCodePlatform(): { resourceDir: string; buildName: string; binaryName: string } | null {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
  if (!arch) {
    return null
  }

  if (process.platform === 'darwin') {
    return { resourceDir: `darwin-${arch}`, buildName: `opencode-darwin-${arch}`, binaryName: 'opencode' }
  }
  if (process.platform === 'linux') {
    return { resourceDir: `linux-${arch}`, buildName: `opencode-linux-${arch}`, binaryName: 'opencode' }
  }
  if (process.platform === 'win32') {
    return { resourceDir: `win32-${arch}`, buildName: `opencode-windows-${arch}`, binaryName: 'opencode.exe' }
  }
  return null
}

function resolveDevelopmentOpenCodeBinary(
  platform: NonNullable<ReturnType<typeof getOpenCodePlatform>>
): string | undefined {
  const binDir = path.join(
    process.cwd(),
    'vendor',
    'opencode',
    'packages',
    'opencode',
    'dist',
    platform.buildName,
    'bin'
  )
  const candidates =
    process.platform === 'win32'
      ? [path.join(binDir, 'opencode.exe'), path.join(binDir, 'opencode')]
      : [path.join(binDir, 'opencode')]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

function remapAsarResourcePath(filePath: string, appPath: string): string {
  if (appPath.endsWith('.asar') && filePath.startsWith(`${appPath}${path.sep}`)) {
    return path.join(appPath.replace(/\.asar$/, '.asar.unpacked'), path.relative(appPath, filePath))
  }
  return toAsarUnpackedPath(filePath)
}

function readConfiguredOpenCodePath(runtimeConfig?: AgentRuntimeConfig): string | undefined {
  const sidecar = asRecord(runtimeConfig?.sidecar)
  return (
    readString(sidecar?.binaryPath) ??
    readString(sidecar?.opencodePath) ??
    readString(sidecar?.openCodePath) ??
    readString(sidecar?.executablePath)
  )
}

function normalizeRuntimeConfig(runtimeConfig?: AgentRuntimeConfig): AgentRuntimeConfig {
  return {
    kind: 'opencode',
    mode: 'managed',
    ...runtimeConfig
  } as AgentRuntimeConfig
}

function callOpenCodeConfigGet(client: OpenCodeClient, cwd: string): Promise<unknown> {
  if (typeof client.config?.get !== 'function') {
    return Promise.resolve({})
  }
  return client.config.get({ query: { directory: cwd } })
}

function callOpenCodeProviders(client: OpenCodeClient, cwd: string): Promise<unknown> {
  if (typeof client.config?.providers !== 'function') {
    throw new Error('OpenCode client does not expose config.providers().')
  }
  return client.config.providers({ query: { directory: cwd } })
}

function waitForOpenCodeServerUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!child.stdout || !child.stderr) {
      stopProcess(child)
      reject(new Error('OpenCode serve process did not expose stdout/stderr.'))
      return
    }

    let output = ''
    let settled = false
    let timeout: NodeJS.Timeout
    const settle = (result: string | Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      if (result instanceof Error) {
        stopProcess(child)
        reject(result)
      } else {
        resolve(result)
      }
    }
    timeout = setTimeout(() => {
      settle(new Error(`Timeout waiting for OpenCode server to start after ${SERVER_START_TIMEOUT_MS}ms`))
    }, SERVER_START_TIMEOUT_MS)

    const onData = (chunk: Buffer | string): void => {
      output += chunk.toString()
      for (const line of output.split('\n')) {
        if (!line.includes('opencode server listening')) {
          continue
        }
        const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
        if (match?.[1]) {
          settle(match[1])
          return
        }
        settle(new Error(`Failed to parse OpenCode server URL from output: ${line}`))
      }
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.once('error', settle)
    child.once('exit', (code, signal) => {
      if (settled) {
        return
      }
      const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`
      const trimmedOutput = output.trim()
      settle(
        new Error(
          trimmedOutput
            ? `OpenCode serve exited with ${detail}: ${trimmedOutput}`
            : `OpenCode serve exited with ${detail}`
        )
      )
    })
  })
}

function resolveOpenCodeAuthHeaders(authRef?: string): Record<string, string> | undefined {
  return authRef ? { authorization: `Bearer ${authRef}` } : undefined
}

function readResponseData(response: unknown): unknown {
  return (response as any)?.data ?? response ?? {}
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : undefined
}

function sanitizeOpenCodeId(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]/g, '-')
  return sanitized || 'provider'
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function stopProcess(child: ChildProcess): void {
  if (!child.killed) {
    child.kill()
  }
}
