/**
 * ClaudeOAuthProxyService
 *
 * A lightweight local HTTP reverse-proxy that forwards requests to the Anthropic API
 * using the OAuth Bearer token obtained from (in priority order):
 *   1. CLAUDE_CODE_OAUTH_TOKEN environment variable
 *   2. Cherry Studio's saved credentials
 *   3. ~/.claude/credentials.json (Claude Code CLI credentials)
 *
 * This mirrors the pattern used by OpenAIOAuthService so that downstream code (agents,
 * provider configs) can target http://127.0.0.1:<port>/v1 instead of hardcoding the
 * Anthropic API directly.
 */
import http from 'node:http'
import https from 'node:https'

import { loggerService } from '@logger'

import anthropicService from './AnthropicService'
import { ConfigKeys, configManager } from './ConfigManager'

const logger = loggerService.withContext('ClaudeOAuthProxy')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 10532
const ANTHROPIC_API_HOST = 'api.anthropic.com'
const HEALTH_TIMEOUT_MS = 3_000

/** Hop-by-hop headers that must not be forwarded. */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade'
])

type RunState = 'stopped' | 'starting' | 'running' | 'error'

export interface ClaudeProxyOperationResult {
  success: boolean
  message?: string
}

export interface ClaudeProxyStatus {
  runState: RunState
  baseUrl: string
  port: number
}

class ClaudeOAuthProxyService {
  private readonly host = DEFAULT_HOST
  private server: http.Server | null = null
  private runState: RunState = 'stopped'
  private activePort: number | null = null

  // ─── Public API ──────────────────────────────────────────────────────────────

  public async startProxy(): Promise<ClaudeProxyOperationResult> {
    // Already healthy?
    if (this.server?.listening) {
      this.runState = 'running'
      return { success: true }
    }

    // Make sure we actually have a token before starting
    const token = await anthropicService.getValidAccessToken()
    if (!token) {
      this.runState = 'error'
      return {
        success: false,
        message:
          'No Claude OAuth token available. Set the CLAUDE_CODE_OAUTH_TOKEN environment variable or ensure ~/.claude/credentials.json exists.'
      }
    }

    const port = this.getConfiguredPort()
    this.runState = 'starting'

    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        void this.handleRequest(req, res)
      })

      server.on('error', (err: NodeJS.ErrnoException) => {
        this.runState = 'error'
        this.server = null
        this.activePort = null
        logger.error('Claude OAuth proxy server error', err)
        resolve({ success: false, message: err.message })
      })

      server.listen(port, this.host, () => {
        this.server = server
        this.activePort = port
        this.runState = 'running'
        logger.info(`Claude OAuth proxy listening on ${this.host}:${port}`)
        resolve({ success: true })
      })
    })
  }

  public stopProxy(): ClaudeProxyOperationResult {
    if (!this.server) {
      this.runState = 'stopped'
      return { success: true }
    }

    this.server.close()
    this.server = null
    this.activePort = null
    this.runState = 'stopped'
    logger.info('Claude OAuth proxy stopped')
    return { success: true }
  }

  public getBaseUrl(): string {
    return `http://${this.host}:${this.getResolvedPort()}/v1`
  }

  public getStatus(): ClaudeProxyStatus {
    return {
      runState: this.runState,
      baseUrl: this.getBaseUrl(),
      port: this.getResolvedPort()
    }
  }

  // ─── Request handling ────────────────────────────────────────────────────────

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Re-resolve the token on every request so refreshes are picked up automatically
    const token = await anthropicService.getValidAccessToken()
    if (!token) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { type: 'authentication_error', message: 'No Claude OAuth token available' } }))
      return
    }

    // Collect the request body
    const bodyChunks: Buffer[] = []
    for await (const chunk of req) {
      bodyChunks.push(chunk as Buffer)
    }
    const body = Buffer.concat(bodyChunks)

    // Build forwarded headers — strip hop-by-hop and inject auth
    const forwardHeaders: http.OutgoingHttpHeaders = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        forwardHeaders[key] = value
      }
    }
    forwardHeaders['host'] = ANTHROPIC_API_HOST
    forwardHeaders['authorization'] = `Bearer ${token}`
    // Required by the Anthropic API
    forwardHeaders['anthropic-version'] = forwardHeaders['anthropic-version'] ?? '2023-06-01'
    if (body.length > 0) {
      forwardHeaders['content-length'] = String(body.length)
    }

    const options: https.RequestOptions = {
      hostname: ANTHROPIC_API_HOST,
      port: 443,
      path: req.url ?? '/',
      method: req.method ?? 'GET',
      headers: forwardHeaders,
      timeout: HEALTH_TIMEOUT_MS * 10
    }

    const proxyReq = https.request(options, (proxyRes) => {
      // Forward response headers (strip hop-by-hop)
      const responseHeaders: http.OutgoingHttpHeaders = {}
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
          responseHeaders[key] = value
        }
      }
      res.writeHead(proxyRes.statusCode ?? 200, responseHeaders)
      proxyRes.pipe(res, { end: true })
    })

    proxyReq.on('error', (err) => {
      logger.error('Claude proxy upstream request error', err)
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { type: 'proxy_error', message: err.message } }))
      }
    })

    if (body.length > 0) {
      proxyReq.write(body)
    }
    proxyReq.end()
  }

  // ─── Port helpers ─────────────────────────────────────────────────────────────

  private getConfiguredPort(): number {
    const configured = configManager.get<number>(ConfigKeys.ClaudeOAuthProxyPort, DEFAULT_PORT)
    return Number.isInteger(configured) && configured > 0 && configured <= 65535 ? configured : DEFAULT_PORT
  }

  private getResolvedPort(): number {
    return this.activePort ?? this.getConfiguredPort()
  }
}

export const claudeOAuthProxyService = new ClaudeOAuthProxyService()
