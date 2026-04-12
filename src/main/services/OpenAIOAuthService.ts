import { type ChildProcessByStdio, execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import type { Readable } from 'node:stream'

import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import type {
  OpenAIOAuthCredentialStatus,
  OpenAIOAuthHealthInfo,
  OpenAIOAuthInstallInfo,
  OpenAIOAuthRunState,
  OpenAIOAuthStatus,
  OperationResult
} from '@shared/config/types'

import { toAsarUnpackedPath } from '../utils'

const require = createRequire(import.meta.url)
const logger = loggerService.withContext('OpenAIOAuthService')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 10531
const DEFAULT_BASE_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}/v1`
const START_TIMEOUT_MS = 30000
const STOP_TIMEOUT_MS = 5000
const HEALTH_TIMEOUT_MS = 3000
const TOKEN_KEYS = new Set(['access_token', 'accessToken', 'refresh_token', 'refreshToken', 'id_token', 'idToken'])
const KEYCHAIN_HINTS = ['keychain', 'keytar', 'credential_store', 'credentialStore', 'secret_service']

type OpenAIModelsResponse = {
  data?: Array<{ id?: string | null }>
}

type PackageResolution = {
  manifestPath: string
  cliPath: string
}

class OpenAIOAuthService {
  private readonly host = DEFAULT_HOST
  private readonly port = DEFAULT_PORT
  private readonly baseUrl = DEFAULT_BASE_URL
  private proxyProcess: ChildProcessByStdio<null, Readable, Readable> | null = null
  private runState: OpenAIOAuthRunState = 'stopped'

  public async checkInstalled(): Promise<OpenAIOAuthInstallInfo> {
    const resolution = this.resolvePackage()
    return {
      installed: !!resolution,
      path: resolution?.cliPath ?? null
    }
  }

  public async install(): Promise<OperationResult> {
    const installInfo = await this.checkInstalled()
    if (installInfo.installed) {
      return { success: true }
    }

    return {
      success: false,
      message:
        'The bundled openai-oauth sidecar is unavailable. Reinstall the app or run `pnpm install` in development.'
    }
  }

  public async startProxy(): Promise<OperationResult> {
    const installInfo = await this.checkInstalled()
    if (!installInfo.installed) {
      this.runState = 'error'
      return {
        success: false,
        message:
          'The bundled openai-oauth sidecar is unavailable. Reinstall the app or run `pnpm install` in development.'
      }
    }

    const credentialStatus = await this.getCredentialStatus()
    if (credentialStatus.state !== 'valid') {
      this.runState = 'error'
      return {
        success: false,
        message:
          credentialStatus.message ??
          'Codex OAuth credentials are unavailable. Run `codex login` and make sure it writes to ~/.codex/auth.json or $CODEX_HOME/auth.json.'
      }
    }

    const currentHealth = await this.checkHealth()
    if (currentHealth.status === 'healthy') {
      this.runState = 'running'
      return { success: true }
    }

    if (this.proxyProcess) {
      await this.stopProxy()
    }

    const resolution = this.resolvePackage()
    if (!resolution) {
      this.runState = 'error'
      return {
        success: false,
        message: 'Unable to resolve the bundled openai-oauth CLI entrypoint.'
      }
    }

    const authFilePath = credentialStatus.authFilePath
    if (!authFilePath) {
      this.runState = 'error'
      return {
        success: false,
        message: 'No file-backed Codex OAuth credentials were found.'
      }
    }

    const args = [
      resolution.cliPath,
      '--host',
      this.host,
      '--port',
      String(this.port),
      '--oauth-file',
      authFilePath
    ]

    const env = {
      ...process.env,
      CODEX_HOME: path.dirname(authFilePath),
      ELECTRON_RUN_AS_NODE: '1'
    }

    logger.info('Starting openai-oauth proxy', {
      cliPath: resolution.cliPath,
      host: this.host,
      port: this.port,
      authFilePath
    })

    this.runState = 'starting'

    try {
      const proc = spawn(process.execPath, args, {
        env,
        detached: !isWin,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })

      this.proxyProcess = proc

      proc.stdout.on('data', (chunk: Buffer) => {
        const message = chunk.toString().trim()
        if (message) {
          logger.debug('openai-oauth stdout', { message })
        }
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        const message = chunk.toString().trim()
        if (message) {
          logger.warn('openai-oauth stderr', { message })
        }
      })

      proc.on('error', (error) => {
        logger.error('openai-oauth process error', error)
        if (this.proxyProcess === proc) {
          this.runState = 'error'
        }
      })

      proc.on('exit', (code, signal) => {
        logger.info('openai-oauth process exited', { code, signal })
        if (this.proxyProcess === proc) {
          this.proxyProcess = null
          this.runState = code === 0 ? 'stopped' : 'error'
        }
      })

      proc.unref()

      const health = await this.waitForHealthy()
      if (health.status === 'healthy') {
        this.runState = 'running'
        return { success: true }
      }

      this.runState = 'error'
      return {
        success: false,
        message: health.message ?? 'The OpenAI OAuth proxy did not become healthy before timing out.'
      }
    } catch (error) {
      this.runState = 'error'
      logger.error('Failed to start openai-oauth proxy', error as Error)
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to start the OpenAI OAuth proxy.'
      }
    }
  }

  public async stopProxy(): Promise<OperationResult> {
    const proc = this.proxyProcess
    if (!proc) {
      const health = await this.checkHealth()
      this.runState = health.status === 'healthy' ? 'running' : 'stopped'

      if (health.status === 'healthy') {
        return {
          success: false,
          message: 'A proxy is still running on the local port, but it is not managed by this app session.'
        }
      }

      return { success: true }
    }

    this.proxyProcess = null

    try {
      this.killProcess(proc)
      const stopped = await this.waitForStop()
      this.runState = stopped ? 'stopped' : 'error'

      if (!stopped) {
        return { success: false, message: 'The OpenAI OAuth proxy did not stop cleanly.' }
      }

      return { success: true }
    } catch (error) {
      this.runState = 'error'
      logger.error('Failed to stop openai-oauth proxy', error as Error)
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to stop the OpenAI OAuth proxy.'
      }
    }
  }

  public async getStatus(): Promise<OpenAIOAuthStatus> {
    const installInfo = await this.checkInstalled()
    const credentialStatus = await this.getCredentialStatus()
    const health = await this.checkHealth()

    if (health.status === 'healthy') {
      this.runState = 'running'
    } else if (!this.proxyProcess && this.runState !== 'starting') {
      this.runState = 'stopped'
    }

    return {
      installState: installInfo.installed ? 'installed' : 'missing',
      runState: this.runState,
      healthState: health.status,
      credentialStatus,
      host: this.host,
      port: this.port,
      baseUrl: this.baseUrl,
      availableModels: health.models,
      message: credentialStatus.message ?? health.message
    }
  }

  public async checkHealth(): Promise<OpenAIOAuthHealthInfo> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
      })

      if (!response.ok) {
        return {
          status: 'unhealthy',
          models: [],
          message: `Health probe failed with status ${response.status}.`
        }
      }

      const json = (await response.json()) as OpenAIModelsResponse
      const models = this.extractModels(json)
      return { status: 'healthy', models }
    } catch (error) {
      return {
        status: 'unhealthy',
        models: [],
        message: error instanceof Error ? error.message : 'The OpenAI OAuth proxy is not reachable.'
      }
    }
  }

  public async getBaseUrl(): Promise<string> {
    return this.baseUrl
  }

  public async getModels(): Promise<string[]> {
    const health = await this.checkHealth()
    return health.models
  }

  private async getCredentialStatus(): Promise<OpenAIOAuthCredentialStatus> {
    const authFilePath = this.resolveAuthFilePath()
    if (!authFilePath) {
      return {
        state: 'missing',
        authFilePath: null,
        message:
          'No file-backed Codex OAuth cache was found. Run `codex login` and ensure it writes to ~/.codex/auth.json or $CODEX_HOME/auth.json.'
      }
    }

    try {
      const raw = await fs.promises.readFile(authFilePath, 'utf-8')
      const parsed = JSON.parse(raw) as unknown

      if (this.containsTokenValue(parsed)) {
        return { state: 'valid', authFilePath }
      }

      if (this.containsKeychainHint(parsed)) {
        return {
          state: 'unsupported',
          authFilePath,
          message:
            'Codex appears to be using OS-managed credential storage. This app currently supports only file-backed auth.json credentials.'
        }
      }

      return {
        state: 'unsupported',
        authFilePath,
        message:
          'The auth.json file does not contain reusable OAuth tokens. Re-run `codex login` with file-backed credential storage.'
      }
    } catch (error) {
      logger.error('Failed to inspect Codex auth file', error as Error)
      return {
        state: 'invalid',
        authFilePath,
        message: 'The Codex auth.json file could not be parsed.'
      }
    }
  }

  private resolvePackage(): PackageResolution | null {
    try {
      const manifestPath = require.resolve('openai-oauth/package.json')
      const packageJson = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
        bin?: string | Record<string, string>
      }
      const binValue =
        typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.['openai-oauth'] ?? null

      if (!binValue) {
        return null
      }

      const cliPath = toAsarUnpackedPath(path.resolve(path.dirname(manifestPath), binValue))
      if (!fs.existsSync(cliPath)) {
        return null
      }

      return { manifestPath, cliPath }
    } catch (error) {
      logger.warn('Unable to resolve openai-oauth package', {
        message: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  private resolveAuthFilePath(): string | null {
    const candidates = [
      process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, 'auth.json') : null,
      path.join(os.homedir(), '.codex', 'auth.json')
    ].filter((candidate): candidate is string => !!candidate)

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    return null
  }

  private containsTokenValue(value: unknown, currentKey?: string): boolean {
    if (typeof value === 'string') {
      return !!currentKey && TOKEN_KEYS.has(currentKey) && value.trim().length > 0
    }

    if (Array.isArray(value)) {
      return value.some((entry) => this.containsTokenValue(entry, currentKey))
    }

    if (!value || typeof value !== 'object') {
      return false
    }

    return Object.entries(value).some(([key, entry]) => this.containsTokenValue(entry, key))
  }

  private containsKeychainHint(value: unknown, currentKey?: string): boolean {
    if (typeof value === 'string') {
      const haystack = `${currentKey ?? ''}:${value}`.toLowerCase()
      return KEYCHAIN_HINTS.some((hint) => haystack.includes(hint))
    }

    if (Array.isArray(value)) {
      return value.some((entry) => this.containsKeychainHint(entry, currentKey))
    }

    if (!value || typeof value !== 'object') {
      return false
    }

    return Object.entries(value).some(([key, entry]) => this.containsKeychainHint(entry, key))
  }

  private extractModels(payload: OpenAIModelsResponse): string[] {
    if (!Array.isArray(payload.data)) {
      return []
    }

    return payload.data
      .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
      .filter((modelId) => modelId.length > 0)
  }

  private async waitForHealthy(): Promise<OpenAIOAuthHealthInfo> {
    const startedAt = Date.now()
    let lastHealth: OpenAIOAuthHealthInfo = {
      status: 'unhealthy',
      models: [],
      message: 'The OpenAI OAuth proxy has not started yet.'
    }

    while (Date.now() - startedAt < START_TIMEOUT_MS) {
      await this.sleep(750)
      lastHealth = await this.checkHealth()
      if (lastHealth.status === 'healthy') {
        return lastHealth
      }
    }

    return lastHealth
  }

  private async waitForStop(): Promise<boolean> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < STOP_TIMEOUT_MS) {
      await this.sleep(250)
      const health = await this.checkHealth()
      if (health.status !== 'healthy') {
        return true
      }
    }
    return false
  }

  private killProcess(proc: ChildProcessByStdio<null, Readable, Readable>): void {
    if (proc.killed || !proc.pid) {
      return
    }

    if (isWin) {
      execFileSync('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore' })
      return
    }

    process.kill(-proc.pid, 'SIGTERM')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export const openAIOAuthService = new OpenAIOAuthService()
