import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import type {
  OpenAIOAuthCredentialStatus,
  OpenAIOAuthDiagnostics,
  OpenAIOAuthHealthInfo,
  OpenAIOAuthInstallInfo,
  OpenAIOAuthOperationResult,
  OpenAIOAuthRunState,
  OpenAIOAuthStatus
} from '@shared/config/types'

const logger = loggerService.withContext('OpenAIOAuthService')

const DEFAULT_HOST = '127.0.0.1'
const HEALTH_TIMEOUT_MS = 3000
const TOKEN_KEYS = new Set(['access_token', 'accessToken', 'refresh_token', 'refreshToken', 'id_token', 'idToken'])
const KEYCHAIN_HINTS = ['keychain', 'keytar', 'credential_store', 'credentialStore', 'secret_service']
const INTERNAL_ROUTE_PREFIX = '/_internal/openai-oauth/v1'

type OpenAIModelsResponse = {
  data?: Array<{ id?: string | null }>
}

type OpenAIOAuthFetchHandler = (request: Request) => Promise<Response>

type ApiServerNetworkConfig = {
  host: string
  port: number
}

class OpenAIOAuthService {
  private readonly host = DEFAULT_HOST
  private runState: OpenAIOAuthRunState = 'stopped'
  private lastStartupDiagnostics: OpenAIOAuthDiagnostics | null = null
  private internalFetchHandler: OpenAIOAuthFetchHandler | null = null
  private handlerAuthFilePath: string | null = null

  public async checkInstalled(): Promise<OpenAIOAuthInstallInfo> {
    return {
      installed: true,
      path: 'in-process'
    }
  }

  public async install(): Promise<OpenAIOAuthOperationResult> {
    return { success: true }
  }

  public async startProxy(): Promise<OpenAIOAuthOperationResult> {
    const credentialStatus = await this.getCredentialStatus()
    if (credentialStatus.state !== 'valid') {
      this.runState = 'error'
      return this.createFailureResult(
        'credentials',
        credentialStatus.message ??
          'Codex OAuth credentials are unavailable. Run `codex login` and make sure it writes to ~/.codex/auth.json or $CODEX_HOME/auth.json.'
      )
    }

    this.runState = 'starting'

    try {
      await this.ensureApiServerStarted()
      const health = await this.checkHealth()
      if (health.status === 'healthy') {
        this.runState = 'running'
        this.clearStartupDiagnostics()
        return { success: true }
      }

      this.runState = 'error'
      return this.createFailureResult(
        'health',
        health.message ?? 'The internal OpenAI OAuth endpoint failed to become healthy.'
      )
    } catch (error) {
      this.runState = 'error'
      logger.error('Failed to activate OpenAI OAuth endpoint', error as Error)
      return this.createFailureResult(
        'health',
        error instanceof Error ? error.message : 'Failed to activate the internal OpenAI OAuth endpoint.'
      )
    }
  }

  public async stopProxy(): Promise<OpenAIOAuthOperationResult> {
    this.runState = (await this.isApiServerRunning()) ? 'running' : 'stopped'
    return { success: true }
  }

  public async getStatus(): Promise<OpenAIOAuthStatus> {
    const installInfo = await this.checkInstalled()
    const credentialStatus = await this.getCredentialStatus()
    const serverRunning = await this.isApiServerRunning()
    const health =
      serverRunning && credentialStatus.state === 'valid'
        ? await this.checkHealth()
        : {
            status: 'unhealthy' as const,
            models: [],
            message:
              credentialStatus.state === 'valid'
                ? 'The internal OpenAI OAuth endpoint is not active yet.'
                : credentialStatus.message
          }

    if (!serverRunning) {
      this.runState = 'stopped'
    } else if (credentialStatus.state !== 'valid') {
      this.runState = 'error'
    } else if (health.status === 'healthy') {
      this.runState = 'running'
      this.clearStartupDiagnostics()
    } else {
      this.runState = 'error'
    }

    return {
      installState: installInfo.installed ? 'installed' : 'missing',
      runState: this.runState,
      healthState: health.status,
      credentialStatus,
      host: this.host,
      port: (await this.getApiServerConfig()).port,
      baseUrl: await this.getBaseUrl(),
      availableModels: health.models,
      message: credentialStatus.message ?? this.lastStartupDiagnostics?.summary ?? health.message,
      diagnostics: this.lastStartupDiagnostics ?? undefined
    }
  }

  public async checkHealth(): Promise<OpenAIOAuthHealthInfo> {
    const credentialStatus = await this.getCredentialStatus()
    if (credentialStatus.state !== 'valid') {
      return {
        status: 'unhealthy',
        models: [],
        message: credentialStatus.message
      }
    }

    if (!(await this.isApiServerRunning())) {
      return {
        status: 'unhealthy',
        models: [],
        message: 'The internal OpenAI OAuth endpoint is not active yet.'
      }
    }

    const healthUrl = `${await this.getBaseUrl()}/models`

    try {
      const response = await fetch(healthUrl, {
        headers: {
          Accept: 'application/json',
          ...(await this.getRequestHeaders())
        },
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
      })

      if (!response.ok) {
        return {
          status: 'unhealthy',
          models: [],
          message: `Internal OpenAI OAuth endpoint health check on ${healthUrl} returned status ${response.status}.`
        }
      }

      const json = (await response.json()) as OpenAIModelsResponse
      return {
        status: 'healthy',
        models: this.extractModels(json)
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        models: [],
        message: this.formatHealthFailureMessage(healthUrl, error)
      }
    }
  }

  public async getBaseUrl(): Promise<string> {
    const { host, port } = await this.getApiServerConfig()
    return `http://${this.resolveBaseUrlHost(host)}:${port}${INTERNAL_ROUTE_PREFIX}`
  }

  public async getRequestHeaders(): Promise<Record<string, string>> {
    const { config } = await import('../apiServer/config')
    const { apiKey } = await config.get()
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  }

  public async getModels(): Promise<string[]> {
    const health = await this.checkHealth()
    return health.models
  }

  public async handleInternalRequest(request: Request): Promise<Response> {
    const credentialStatus = await this.getCredentialStatus()
    if (credentialStatus.state !== 'valid' || !credentialStatus.authFilePath) {
      return this.createJsonResponse(
        401,
        {
          error: {
            message: credentialStatus.message ?? 'OpenAI OAuth credentials are not available.',
            type: 'authentication_error',
            code: 'missing_oauth_credentials'
          }
        },
        { 'Content-Type': 'application/json' }
      )
    }

    const handler = await this.getInternalFetchHandler(credentialStatus.authFilePath)
    return handler(request)
  }

  private async getInternalFetchHandler(authFilePath: string): Promise<OpenAIOAuthFetchHandler> {
    if (this.internalFetchHandler && this.handlerAuthFilePath === authFilePath) {
      return this.internalFetchHandler
    }

    const { createOpenAIOAuthFetchHandler } = await import('openai-oauth')
    this.internalFetchHandler = createOpenAIOAuthFetchHandler({
      authFilePath,
      requestLogger: (event) => {
        if (event.type === 'chat_error') {
          logger.error('Internal OpenAI OAuth request failed', event)
          return
        }

        logger.debug('Internal OpenAI OAuth request', event)
      }
    })
    this.handlerAuthFilePath = authFilePath
    return this.internalFetchHandler
  }

  private async ensureApiServerStarted(): Promise<void> {
    const { apiServerService } = await import('./ApiServerService')
    if (!apiServerService.isRunning()) {
      await apiServerService.start()
    }
  }

  private async isApiServerRunning(): Promise<boolean> {
    const { apiServerService } = await import('./ApiServerService')
    return apiServerService.isRunning()
  }

  private async getApiServerConfig(): Promise<ApiServerNetworkConfig> {
    const { config } = await import('../apiServer/config')
    const { host, port } = await config.get()
    return { host, port }
  }

  private resolveBaseUrlHost(host: string): string {
    if (!host || host === '0.0.0.0' || host === '::') {
      return this.host
    }

    return host
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

  private formatHealthFailureMessage(healthUrl: string, error: unknown): string {
    if (error instanceof Error) {
      const message = error.message.trim()
      if (message.toLowerCase() === 'fetch failed') {
        return `Internal OpenAI OAuth endpoint health check on ${healthUrl} failed. The local route is not reachable yet.`
      }

      return `Internal OpenAI OAuth endpoint health check on ${healthUrl} failed: ${message}`
    }

    return `Internal OpenAI OAuth endpoint health check on ${healthUrl} failed. The local route is not reachable yet.`
  }

  private createJsonResponse(status: number, payload: unknown, headers?: HeadersInit): Response {
    return new Response(JSON.stringify(payload), {
      status,
      headers
    })
  }
}

export const openAIOAuthService = new OpenAIOAuthService()
