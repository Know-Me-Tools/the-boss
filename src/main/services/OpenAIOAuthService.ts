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
  OpenAIOAuthDiagnostics,
  OpenAIOAuthHealthInfo,
  OpenAIOAuthInstallInfo,
  OpenAIOAuthOperationResult,
  OpenAIOAuthRunState,
  OpenAIOAuthStatus
} from '@shared/config/types'

import { toAsarUnpackedPath } from '../utils'
import { ConfigKeys, configManager } from './ConfigManager'

const require = createRequire(import.meta.url)
const logger = loggerService.withContext('OpenAIOAuthService')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 10531
const START_TIMEOUT_MS = 30000
const STOP_TIMEOUT_MS = 5000
const HEALTH_TIMEOUT_MS = 3000
const DIAGNOSTIC_OUTPUT_LIMIT = 4000
const DIAGNOSTIC_LINE_LIMIT = 8
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
  private proxyProcess: ChildProcessByStdio<null, Readable, Readable> | null = null
  private runState: OpenAIOAuthRunState = 'stopped'
  private activePort: number | null = null
  private lastStartupDiagnostics: OpenAIOAuthDiagnostics | null = null

  public async checkInstalled(): Promise<OpenAIOAuthInstallInfo> {
    const resolution = this.resolvePackage()
    return {
      installed: !!resolution,
      path: resolution?.cliPath ?? null
    }
  }

  public async install(): Promise<OpenAIOAuthOperationResult> {
    const installInfo = await this.checkInstalled()
    if (installInfo.installed) {
      return { success: true }
    }

    return this.createFailureResult(
      'spawn',
      'The bundled openai-oauth sidecar is unavailable. Reinstall the app or run `pnpm install` in development.'
    )
  }

  public async startProxy(): Promise<OpenAIOAuthOperationResult> {
    const configuredPort = this.getConfiguredPort()
    const installInfo = await this.checkInstalled()
    if (!installInfo.installed) {
      this.runState = 'error'
      return this.createFailureResult(
        'spawn',
        'The bundled openai-oauth sidecar is unavailable. Reinstall the app or run `pnpm install` in development.'
      )
    }

    const credentialStatus = await this.getCredentialStatus()
    if (credentialStatus.state !== 'valid') {
      this.runState = 'error'
      return this.createFailureResult(
        'credentials',
        credentialStatus.message ??
          'Codex OAuth credentials are unavailable. Run `codex login` and make sure it writes to ~/.codex/auth.json or $CODEX_HOME/auth.json.'
      )
    }

    if (this.proxyProcess && this.activePort && this.activePort !== configuredPort) {
      await this.stopProxy()
    }

    const currentHealth = await this.checkHealth(configuredPort)
    if (currentHealth.status === 'healthy') {
      this.activePort = configuredPort
      this.runState = 'running'
      this.clearStartupDiagnostics()
      return { success: true }
    }

    if (this.proxyProcess) {
      await this.stopProxy()
    }

    const resolution = this.resolvePackage()
    if (!resolution) {
      this.runState = 'error'
      return this.createFailureResult('spawn', 'Unable to resolve the bundled openai-oauth CLI entrypoint.')
    }

    const authFilePath = credentialStatus.authFilePath
    if (!authFilePath) {
      this.runState = 'error'
      return this.createFailureResult('credentials', 'No file-backed Codex OAuth credentials were found.')
    }

    this.clearStartupDiagnostics()

    const args = [
      resolution.cliPath,
      '--host',
      this.host,
      '--port',
      String(configuredPort),
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
      port: configuredPort,
      authFilePath
    })

    this.runState = 'starting'
    this.activePort = configuredPort

    try {
      let stdoutOutput = ''
      let stderrOutput = ''
      let earlyExitSummary = ''
      let exitCode: number | null = null
      let exitSignal: NodeJS.Signals | null = null

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
          stdoutOutput = this.appendDiagnosticOutput(stdoutOutput, message)
          logger.debug('openai-oauth stdout', { message })
        }
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        const message = chunk.toString().trim()
        if (message) {
          stderrOutput = this.appendDiagnosticOutput(stderrOutput, message)
          logger.warn('openai-oauth stderr', { message })
        }
      })

      proc.on('error', (error) => {
        earlyExitSummary = `Proxy failed to start: ${error.message}`
        logger.error('openai-oauth process error', error)
        if (this.proxyProcess === proc) {
          this.runState = 'error'
        }
      })

      proc.on('exit', (code, signal) => {
        exitCode = code
        exitSignal = signal
        earlyExitSummary = this.formatEarlyExitSummary(code, signal)
        logger.info('openai-oauth process exited', { code, signal })
        if (this.proxyProcess === proc) {
          this.proxyProcess = null
          this.activePort = null
          this.runState = code === 0 ? 'stopped' : 'error'
        }
      })

      proc.unref()

      const health = await this.waitForHealthy(configuredPort, () => earlyExitSummary)
      if (health.status === 'healthy') {
        this.runState = 'running'
        this.clearStartupDiagnostics()
        return { success: true }
      }

      this.activePort = null
      this.runState = 'error'
      const summary =
        earlyExitSummary ||
        health.message ||
        `Proxy failed health check on ${this.getHealthUrlForPort(configuredPort)} before becoming healthy.`
      const details = this.buildStartupFailureDetails({
        cliPath: resolution.cliPath,
        authFilePath,
        healthUrl: this.getHealthUrlForPort(configuredPort),
        healthMessage: health.message,
        stdoutOutput,
        stderrOutput,
        exitCode,
        exitSignal
      })
      const source = this.resolveDiagnosticsSource({ stderrOutput, stdoutOutput, exitCode, exitSignal, healthMessage: health.message })

      return this.createFailureResult(source, summary, details)
    } catch (error) {
      this.activePort = null
      this.runState = 'error'
      logger.error('Failed to start openai-oauth proxy', error as Error)
      return this.createFailureResult(
        'spawn',
        error instanceof Error ? error.message : 'Failed to start the OpenAI OAuth proxy.'
      )
    }
  }

  public async stopProxy(): Promise<OpenAIOAuthOperationResult> {
    const proc = this.proxyProcess
    if (!proc) {
      const health = await this.checkHealth()
      this.runState = health.status === 'healthy' ? 'running' : 'stopped'
      this.activePort = health.status === 'healthy' ? this.getResolvedPort() : null

      if (health.status === 'healthy') {
        return this.createFailureResult(
          'health',
          'A proxy is still running on the local port, but it is not managed by this app session.'
        )
      }

      return { success: true }
    }

    this.proxyProcess = null
    this.activePort = null

    try {
      this.killProcess(proc)
      const stopped = await this.waitForStop()
      this.runState = stopped ? 'stopped' : 'error'

      if (!stopped) {
        return this.createFailureResult('health', 'The OpenAI OAuth proxy did not stop cleanly.')
      }

      return { success: true }
    } catch (error) {
      this.runState = 'error'
      logger.error('Failed to stop openai-oauth proxy', error as Error)
      return this.createFailureResult(
        'spawn',
        error instanceof Error ? error.message : 'Failed to stop the OpenAI OAuth proxy.'
      )
    }
  }

  public async getStatus(): Promise<OpenAIOAuthStatus> {
    const installInfo = await this.checkInstalled()
    const credentialStatus = await this.getCredentialStatus()
    const health = await this.checkHealth()

    if (health.status === 'healthy') {
      this.runState = 'running'
      this.clearStartupDiagnostics()
    } else if (!this.proxyProcess && this.runState !== 'starting') {
      this.runState = 'stopped'
    }

    return {
      installState: installInfo.installed ? 'installed' : 'missing',
      runState: this.runState,
      healthState: health.status,
      credentialStatus,
      host: this.host,
      port: this.getResolvedPort(),
      baseUrl: this.getBaseUrlForPort(),
      availableModels: health.models,
      message: credentialStatus.message ?? this.lastStartupDiagnostics?.summary ?? health.message,
      diagnostics: this.lastStartupDiagnostics ?? undefined
    }
  }

  public async checkHealth(port = this.getResolvedPort()): Promise<OpenAIOAuthHealthInfo> {
    const healthUrl = this.getHealthUrlForPort(port)

    try {
      const response = await fetch(healthUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
      })

      if (!response.ok) {
        return {
          status: 'unhealthy',
          models: [],
          message: `Proxy health check on ${healthUrl} returned status ${response.status}.`
        }
      }

      const json = (await response.json()) as OpenAIModelsResponse
      const models = this.extractModels(json)
      return { status: 'healthy', models }
    } catch (error) {
      return {
        status: 'unhealthy',
        models: [],
        message: this.formatHealthFailureMessage(healthUrl, error)
      }
    }
  }

  public async getBaseUrl(): Promise<string> {
    return this.getBaseUrlForPort()
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
      const resolvedEntryPath = require.resolve('openai-oauth')
      const manifestPath = this.findPackageManifestPath(path.dirname(resolvedEntryPath))
      if (!manifestPath) {
        return null
      }

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

  private findPackageManifestPath(startDir: string): string | null {
    let currentDir = startDir

    while (true) {
      const manifestPath = path.join(currentDir, 'package.json')
      if (fs.existsSync(manifestPath)) {
        return manifestPath
      }

      const parentDir = path.dirname(currentDir)
      if (parentDir === currentDir) {
        return null
      }

      currentDir = parentDir
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

  private async waitForHealthy(port: number, getEarlyExitSummary?: () => string): Promise<OpenAIOAuthHealthInfo> {
    const startedAt = Date.now()
    let lastHealth: OpenAIOAuthHealthInfo = {
      status: 'unhealthy',
      models: [],
      message: 'The OpenAI OAuth proxy has not started yet.'
    }

    while (Date.now() - startedAt < START_TIMEOUT_MS) {
      const earlyExitSummary = getEarlyExitSummary?.()
      if (earlyExitSummary) {
        return {
          status: 'unhealthy',
          models: [],
          message: earlyExitSummary
        }
      }

      await this.sleep(750)
      const earlyExitAfterDelay = getEarlyExitSummary?.()
      if (earlyExitAfterDelay) {
        return {
          status: 'unhealthy',
          models: [],
          message: earlyExitAfterDelay
        }
      }

      lastHealth = await this.checkHealth(port)
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

  private getConfiguredPort(): number {
    const configuredPort = configManager.get<number>(ConfigKeys.OpenAIOAuthPort, DEFAULT_PORT)
    return Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535 ? configuredPort : DEFAULT_PORT
  }

  private getResolvedPort(): number {
    return this.activePort ?? this.getConfiguredPort()
  }

  private getBaseUrlForPort(port = this.getResolvedPort()): string {
    return `http://${this.host}:${port}/v1`
  }

  private getHealthUrlForPort(port = this.getResolvedPort()): string {
    return `${this.getBaseUrlForPort(port)}/models`
  }

  private clearStartupDiagnostics(): void {
    this.lastStartupDiagnostics = null
  }

  private createFailureResult(
    source: OpenAIOAuthDiagnostics['source'],
    summary: string,
    details?: string
  ): OpenAIOAuthOperationResult {
    const diagnostics = this.createDiagnostics(source, summary, details)
    this.lastStartupDiagnostics = diagnostics
    return {
      success: false,
      message: summary,
      diagnostics
    }
  }

  private createDiagnostics(
    source: OpenAIOAuthDiagnostics['source'],
    summary: string,
    details?: string
  ): OpenAIOAuthDiagnostics {
    return {
      source,
      summary,
      details: details || undefined,
      updatedAt: new Date().toISOString()
    }
  }

  private appendDiagnosticOutput(existing: string, chunk: string): string {
    const next = existing ? `${existing}\n${chunk}` : chunk
    return next.length > DIAGNOSTIC_OUTPUT_LIMIT ? next.slice(next.length - DIAGNOSTIC_OUTPUT_LIMIT) : next
  }

  private limitDiagnosticOutput(text: string): string | undefined {
    const trimmed = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (trimmed.length === 0) {
      return undefined
    }

    return trimmed.slice(-DIAGNOSTIC_LINE_LIMIT).join('\n')
  }

  private formatHealthFailureMessage(healthUrl: string, error: unknown): string {
    if (error instanceof Error) {
      const message = error.message.trim()
      if (message.toLowerCase() === 'fetch failed') {
        return `Proxy failed health check on ${healthUrl}. The local sidecar is not reachable yet.`
      }

      return `Proxy failed health check on ${healthUrl}: ${message}`
    }

    return `Proxy failed health check on ${healthUrl}. The local sidecar is not reachable yet.`
  }

  private formatEarlyExitSummary(code: number | null, signal: NodeJS.Signals | null): string {
    if (signal) {
      return `Proxy exited before becoming healthy (signal ${signal}).`
    }

    if (typeof code === 'number') {
      return `Proxy exited before becoming healthy (code ${code}).`
    }

    return 'Proxy exited before becoming healthy.'
  }

  private buildStartupFailureDetails({
    cliPath,
    authFilePath,
    healthUrl,
    healthMessage,
    stdoutOutput,
    stderrOutput,
    exitCode,
    exitSignal
  }: {
    cliPath: string
    authFilePath: string
    healthUrl: string
    healthMessage?: string
    stdoutOutput: string
    stderrOutput: string
    exitCode: number | null
    exitSignal: NodeJS.Signals | null
  }): string | undefined {
    const parts = [
      `Health endpoint: ${healthUrl}`,
      `CLI: ${cliPath}`,
      `Auth file: ${authFilePath}`,
      healthMessage ? `Health: ${healthMessage}` : '',
      typeof exitCode === 'number' ? `Exit code: ${exitCode}` : '',
      exitSignal ? `Exit signal: ${exitSignal}` : '',
      stderrOutput ? `stderr:\n${this.limitDiagnosticOutput(stderrOutput)}` : '',
      stdoutOutput ? `stdout:\n${this.limitDiagnosticOutput(stdoutOutput)}` : ''
    ].filter(Boolean)

    return parts.length > 0 ? parts.join('\n\n') : undefined
  }

  private resolveDiagnosticsSource({
    stderrOutput,
    stdoutOutput,
    exitCode,
    exitSignal,
    healthMessage
  }: {
    stderrOutput: string
    stdoutOutput: string
    exitCode: number | null
    exitSignal: NodeJS.Signals | null
    healthMessage?: string
  }): OpenAIOAuthDiagnostics['source'] {
    if (stderrOutput) {
      return 'stderr'
    }

    if (typeof exitCode === 'number' || exitSignal) {
      return 'exit'
    }

    if (stdoutOutput) {
      return 'stdout'
    }

    if (healthMessage) {
      return 'health'
    }

    return 'spawn'
  }
}

export const openAIOAuthService = new OpenAIOAuthService()
