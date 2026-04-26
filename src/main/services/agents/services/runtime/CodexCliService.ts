import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import readline from 'node:readline'

import { loggerService } from '@logger'
import { toAsarUnpackedPath } from '@main/utils'
import type { AgentRuntimeConfig } from '@types'
import { app } from 'electron'

const logger = loggerService.withContext('CodexCliService')
const require_ = createRequire(import.meta.url)
const MODEL_LIST_CACHE_TTL = 60 * 1000
const APP_SERVER_TIMEOUT = 10 * 1000
const DEFAULT_CODEX_MODEL_ID = 'gpt-5.5'

export interface CodexBinaryResolution {
  path?: string
  source?: 'configured' | 'packaged' | 'development'
  state: 'ready' | 'missing-binary' | 'unsupported-platform'
  message: string
}

export interface CodexRuntimeModel {
  id: string
  model: string
  displayName: string
  description?: string
  hidden: boolean
  isDefault: boolean
  supportedReasoningEfforts: string[]
  defaultReasoningEffort?: string
}

interface JsonRpcMessage {
  id?: number
  method?: string
  result?: unknown
  error?: {
    code?: number
    message?: string
    data?: unknown
  }
}

type SpawnCodexProcess = (command: string, args: string[], options: Parameters<typeof spawn>[2]) => ChildProcess

interface CodexCliServiceDependencies {
  spawnProcess?: SpawnCodexProcess
  appPath?: () => string
  developmentBinaryPath?: (platform: NonNullable<ReturnType<typeof getCodexPlatform>>) => string | undefined
}

export class CodexCliService {
  private readonly spawnProcess: SpawnCodexProcess
  private readonly appPath: () => string
  private readonly developmentBinaryPath: (
    platform: NonNullable<ReturnType<typeof getCodexPlatform>>
  ) => string | undefined
  private modelCache: { expiresAt: number; models: CodexRuntimeModel[] } | null = null

  constructor(dependencies: CodexCliServiceDependencies = {}) {
    this.spawnProcess = dependencies.spawnProcess ?? ((command, args, options) => spawn(command, args, options))
    this.appPath = dependencies.appPath ?? (() => app.getAppPath())
    this.developmentBinaryPath = dependencies.developmentBinaryPath ?? resolveDevelopmentCodexBinary
  }

  resolveBinary(runtimeConfig?: AgentRuntimeConfig): CodexBinaryResolution {
    const platform = getCodexPlatform()
    if (!platform) {
      return {
        state: 'unsupported-platform',
        message: `Codex runtime is not supported on ${process.platform}/${process.arch}.`
      }
    }

    const configuredPath = readConfiguredCodexPath(runtimeConfig)
    if (configuredPath) {
      const configured = this.validateCandidate(configuredPath, 'configured')
      if (configured) {
        return configured
      }
    }

    const packagedPath = toAsarUnpackedPath(
      path.join(
        this.appPath(),
        'node_modules',
        ...platform.packageName.split('/'),
        'vendor',
        platform.triple,
        'codex',
        platform.binaryName
      )
    )
    const packaged = this.validateCandidate(packagedPath, 'packaged')
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
          ? `Configured Codex executable does not exist: ${configuredPath}`
          : 'Codex CLI executable was not found. Reinstall dependencies or ensure the Codex binary is packaged outside app.asar.'
    }
  }

  async listModels(runtimeConfig?: AgentRuntimeConfig): Promise<CodexRuntimeModel[]> {
    if (this.modelCache && this.modelCache.expiresAt > Date.now()) {
      return this.modelCache.models
    }

    const resolution = this.resolveBinary(runtimeConfig)
    if (!resolution.path) {
      throw new Error(resolution.message)
    }

    const models = withDefaultCodexModel(await this.fetchModelsFromAppServer(resolution.path))
    this.modelCache = {
      expiresAt: Date.now() + MODEL_LIST_CACHE_TTL,
      models
    }
    return models
  }

  clearModelCache(): void {
    this.modelCache = null
  }

  private validateCandidate(
    candidatePath: string,
    source: CodexBinaryResolution['source']
  ): CodexBinaryResolution | null {
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
      message: `Codex CLI executable resolved from ${source}.`
    }
  }

  private async fetchModelsFromAppServer(codexPath: string): Promise<CodexRuntimeModel[]> {
    const child = this.spawnProcess(codexPath, ['app-server', '--listen', 'stdio://'], {
      stdio: 'pipe',
      env: {
        ...process.env,
        CODEX_INTERNAL_ORIGINATOR_OVERRIDE: process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE ?? 'the_boss'
      }
    })
    if (!child.stdin || !child.stdout || !child.stderr) {
      child.kill()
      throw new Error('Codex app-server process did not expose stdio streams.')
    }
    const childStdin = child.stdin
    const childStdout = child.stdout
    const childStderr = child.stderr

    const pending = new Map<number, (message: JsonRpcMessage) => void>()
    const errors: string[] = []
    const rl = readline.createInterface({ input: childStdout, crlfDelay: Infinity })

    childStderr.on('data', (data) => {
      errors.push(String(data))
    })

    child.once('error', (error) => {
      logger.warn('Codex app-server process failed', { error: error.message })
      for (const resolve of pending.values()) {
        resolve({ error: { message: error.message } })
      }
      pending.clear()
    })
    child.once('exit', (code, signal) => {
      if (pending.size === 0) {
        return
      }
      const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`
      const stderr = errors.join('').trim()
      for (const resolve of pending.values()) {
        resolve({
          error: {
            message: stderr
              ? `Codex app-server exited with ${detail}: ${stderr}`
              : `Codex app-server exited with ${detail}`
          }
        })
      }
      pending.clear()
    })

    void (async () => {
      for await (const line of rl) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let message: JsonRpcMessage
        try {
          message = JSON.parse(trimmed)
        } catch (error) {
          logger.warn('Failed to parse Codex app-server response', {
            line: trimmed.slice(0, 500),
            error: error instanceof Error ? error.message : String(error)
          })
          continue
        }

        if (typeof message.id === 'number') {
          const resolve = pending.get(message.id)
          if (resolve) {
            pending.delete(message.id)
            resolve(message)
          }
        }
      }
    })()

    const request = (id: number, method: string, params?: Record<string, unknown>) => {
      childStdin.write(`${JSON.stringify({ id, method, params: params ?? {} })}\n`)
      return waitForResponse(pending, id)
    }

    const timeout = setTimeout(() => {
      child.kill()
    }, APP_SERVER_TIMEOUT)

    try {
      const init = await request(1, 'initialize', {
        clientInfo: {
          name: 'the_boss',
          title: 'The Boss',
          version: app.getVersion?.() ?? 'unknown'
        }
      })
      assertRpcSuccess(init, 'initialize')
      childStdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`)

      const response = await request(2, 'model/list', {})
      assertRpcSuccess(response, 'model/list')
      return parseModelList(response.result)
    } finally {
      clearTimeout(timeout)
      rl.close()
      child.kill()
      if (errors.length > 0) {
        logger.debug('Codex app-server stderr', { stderr: errors.join('').slice(0, 1000) })
      }
    }
  }
}

function waitForResponse(pending: Map<number, (message: JsonRpcMessage) => void>, id: number): Promise<JsonRpcMessage> {
  return new Promise((resolve) => {
    pending.set(id, resolve)
  })
}

function assertRpcSuccess(message: JsonRpcMessage, method: string): void {
  if (message.error) {
    throw new Error(`Codex app-server ${method} failed: ${message.error.message ?? JSON.stringify(message.error)}`)
  }
}

function parseModelList(result: unknown): CodexRuntimeModel[] {
  const data = result && typeof result === 'object' && Array.isArray((result as any).data) ? (result as any).data : []
  return data
    .filter((item: any) => typeof item?.id === 'string')
    .map((item: any) => ({
      id: item.id,
      model: typeof item.model === 'string' ? item.model : item.id,
      displayName: typeof item.displayName === 'string' ? item.displayName : item.id,
      description: typeof item.description === 'string' ? item.description : undefined,
      hidden: item.hidden === true,
      isDefault: item.isDefault === true,
      supportedReasoningEfforts: Array.isArray(item.supportedReasoningEfforts)
        ? item.supportedReasoningEfforts
            .map((effort: any) => effort?.reasoningEffort ?? effort?.reasoning_effort ?? effort)
            .filter((effort: unknown): effort is string => typeof effort === 'string')
        : [],
      defaultReasoningEffort:
        typeof item.defaultReasoningEffort === 'string'
          ? item.defaultReasoningEffort
          : typeof item.default_reasoning_effort === 'string'
            ? item.default_reasoning_effort
            : undefined
    }))
}

function withDefaultCodexModel(models: CodexRuntimeModel[]): CodexRuntimeModel[] {
  const defaultModel = models.find(
    (model) => model.id === DEFAULT_CODEX_MODEL_ID || model.model === DEFAULT_CODEX_MODEL_ID
  )
  const normalizedDefault: CodexRuntimeModel = {
    ...defaultModel,
    id: DEFAULT_CODEX_MODEL_ID,
    model: DEFAULT_CODEX_MODEL_ID,
    displayName: defaultModel?.displayName ?? 'GPT-5.5',
    description: defaultModel?.description,
    hidden: false,
    isDefault: true,
    supportedReasoningEfforts:
      defaultModel && defaultModel.supportedReasoningEfforts.length > 0
        ? defaultModel.supportedReasoningEfforts
        : ['minimal', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: defaultModel?.defaultReasoningEffort ?? 'medium'
  }

  return [
    normalizedDefault,
    ...models
      .filter((model) => model.id !== DEFAULT_CODEX_MODEL_ID && model.model !== DEFAULT_CODEX_MODEL_ID)
      .map((model) => ({
        ...model,
        isDefault: false
      }))
  ]
}

function readConfiguredCodexPath(runtimeConfig?: AgentRuntimeConfig): string | undefined {
  const sidecar = runtimeConfig?.sidecar && typeof runtimeConfig.sidecar === 'object' ? runtimeConfig.sidecar : {}
  const candidates = [sidecar.binaryPath, sidecar.codexPath, sidecar.executablePath]
  return candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim()
}

function resolveDevelopmentCodexBinary(platform: NonNullable<ReturnType<typeof getCodexPlatform>>): string | undefined {
  try {
    const codexPackageJson = require_.resolve('@openai/codex/package.json')
    const codexRequire = createRequire(codexPackageJson)
    const platformPackageJson = codexRequire.resolve(`${platform.packageName}/package.json`)
    return path.join(path.dirname(platformPackageJson), 'vendor', platform.triple, 'codex', platform.binaryName)
  } catch {
    return undefined
  }
}

function getCodexPlatform():
  | {
      triple: string
      packageName: string
      binaryName: string
    }
  | undefined {
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return { triple: 'aarch64-apple-darwin', packageName: '@openai/codex-darwin-arm64', binaryName }
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return { triple: 'x86_64-apple-darwin', packageName: '@openai/codex-darwin-x64', binaryName }
  }
  if (process.platform === 'linux' && process.arch === 'arm64') {
    return { triple: 'aarch64-unknown-linux-musl', packageName: '@openai/codex-linux-arm64', binaryName }
  }
  if ((process.platform === 'linux' || process.platform === 'android') && process.arch === 'x64') {
    return { triple: 'x86_64-unknown-linux-musl', packageName: '@openai/codex-linux-x64', binaryName }
  }
  if (process.platform === 'win32' && process.arch === 'arm64') {
    return { triple: 'aarch64-pc-windows-msvc', packageName: '@openai/codex-win32-arm64', binaryName }
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return { triple: 'x86_64-pc-windows-msvc', packageName: '@openai/codex-win32-x64', binaryName }
  }
  return undefined
}

export const codexCliService = new CodexCliService()
