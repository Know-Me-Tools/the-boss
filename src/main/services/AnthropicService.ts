/**
 * Reference:
 * This code is adapted from https://github.com/ThinkInAIXYZ/deepchat
 * Original file: src/main/presenter/anthropicOAuth.ts
 */
import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { getConfigDir } from '@main/utils/file'
import * as crypto from 'crypto'
import { net, shell } from 'electron'
import { promises } from 'fs'
import { dirname } from 'path'

const logger = loggerService.withContext('AnthropicOAuth')

// Constants
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const CREDS_PATH = path.join(getConfigDir(), 'oauth', 'anthropic.json')
// Claude Code stores its OAuth credentials here
const CLAUDE_CODE_CREDS_PATH = path.join(os.homedir(), '.claude', 'credentials.json')

// Types
interface Credentials {
  access_token: string
  refresh_token: string
  /** Unix ms timestamp. 0 means no expiry (e.g. Claude Code sets expiresAt: null). */
  expires_at: number
}

interface ClaudeCodeOAuthPayload {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
  scopes?: string[]
}

interface ClaudeCodeCredentialsFile {
  oauth?: ClaudeCodeOAuthPayload
}

interface PKCEPair {
  verifier: string
  challenge: string
}

class AnthropicService extends Error {
  private currentPKCE: PKCEPair | null = null

  // 1. Generate PKCE pair
  private generatePKCE(): PKCEPair {
    const verifier = crypto.randomBytes(32).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')

    return { verifier, challenge }
  }

  // 2. Get OAuth authorization URL
  private getAuthorizationURL(pkce: PKCEPair): string {
    const url = new URL('https://claude.ai/oauth/authorize')

    url.searchParams.set('code', 'true')
    url.searchParams.set('client_id', CLIENT_ID)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', 'https://console.anthropic.com/oauth/code/callback')
    url.searchParams.set('scope', 'org:create_api_key user:profile user:inference')
    url.searchParams.set('code_challenge', pkce.challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', pkce.verifier)

    return url.toString()
  }

  // 3. Exchange authorization code for tokens
  private async exchangeCodeForTokens(code: string, verifier: string): Promise<Credentials> {
    // Strip any trailing state fragment (legacy format: code#state)
    const authCode = code.includes('#') ? code.split('#')[0] : code

    const response = await net.fetch('https://console.anthropic.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: authCode,
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
        code_verifier: verifier
      })
    })

    if (!response.ok) {
      // HTTP/2 responses carry no statusText — read the body for the real error detail
      let detail = response.statusText
      try {
        detail = await response.text()
      } catch {
        // ignore body-read errors; fall back to statusText
      }
      throw new Error(`Token exchange failed (${response.status}): ${detail}`)
    }

    const data = await response.json()

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000
    }
  }

  // 4. Refresh access token
  private async refreshAccessToken(refreshToken: string): Promise<Credentials> {
    const response = await net.fetch('https://console.anthropic.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID
      })
    })

    if (!response.ok) {
      let detail = response.statusText
      try {
        detail = await response.text()
      } catch {
        // ignore
      }
      throw new Error(`Token refresh failed (${response.status}): ${detail}`)
    }

    const data = await response.json()

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000
    }
  }

  // 5. Save credentials
  private async saveCredentials(creds: Credentials): Promise<void> {
    await promises.mkdir(dirname(CREDS_PATH), { recursive: true })
    await promises.writeFile(CREDS_PATH, JSON.stringify(creds, null, 2))
    await promises.chmod(CREDS_PATH, 0o600) // Read/write for owner only
  }

  // 6. Load credentials (Cherry Studio's own saved creds)
  private async loadCredentials(): Promise<Credentials | null> {
    try {
      const data = await promises.readFile(CREDS_PATH, 'utf-8')
      return JSON.parse(data)
    } catch {
      return null
    }
  }

  // 6a. Load credentials from Claude Code's credentials file (~/.claude/credentials.json)
  private async loadClaudeCodeCredentials(): Promise<Credentials | null> {
    try {
      const data = await promises.readFile(CLAUDE_CODE_CREDS_PATH, 'utf-8')
      const raw: ClaudeCodeCredentialsFile = JSON.parse(data)
      const oauth = raw.oauth
      if (!oauth?.accessToken || !oauth?.refreshToken) return null
      return {
        access_token: oauth.accessToken,
        refresh_token: oauth.refreshToken,
        // null expiresAt means no expiry — represent as 0 (handled below in getValidAccessToken)
        expires_at: oauth.expiresAt ?? 0
      }
    } catch {
      return null
    }
  }

  // 6b. Import Claude Code credentials into Cherry Studio's credential store
  public async importClaudeCodeCredentials(): Promise<boolean> {
    const creds = await this.loadClaudeCodeCredentials()
    if (!creds) {
      logger.warn('No Claude Code credentials found at ' + CLAUDE_CODE_CREDS_PATH)
      return false
    }
    await this.saveCredentials(creds)
    logger.info('Imported Claude Code credentials successfully')
    return true
  }

  // 7. Get valid access token — priority order:
  //    1. CLAUDE_CODE_OAUTH_TOKEN env var (set by Claude Code CLI)
  //    2. Cherry Studio's own saved creds
  //    3. Claude Code's ~/.claude/credentials.json
  public async getValidAccessToken(): Promise<string | null> {
    // 1. Environment variable — always treated as valid (no expiry check)
    const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
    if (envToken) {
      logger.debug('Using CLAUDE_CODE_OAUTH_TOKEN from environment')
      return envToken
    }

    // 2 & 3. File-based credentials
    let creds = await this.loadCredentials()
    if (!creds) {
      creds = await this.loadClaudeCodeCredentials()
    }
    if (!creds) return null

    // expires_at === 0 means no expiry (Claude Code sets expiresAt: null)
    const isValid = creds.expires_at === 0 || creds.expires_at > Date.now() + 60_000
    if (isValid) {
      return creds.access_token
    }

    // Token is expired — try to refresh
    try {
      const newCreds = await this.refreshAccessToken(creds.refresh_token)
      await this.saveCredentials(newCreds)
      return newCreds.access_token
    } catch {
      return null
    }
  }

  // 8. Start OAuth flow with external browser
  public async startOAuthFlow(): Promise<string> {
    // Try to get existing valid token
    const existingToken = await this.getValidAccessToken()
    if (existingToken) return existingToken

    // Generate PKCE pair and store it for later use
    this.currentPKCE = this.generatePKCE()

    // Build authorization URL
    const authUrl = this.getAuthorizationURL(this.currentPKCE)
    logger.debug(authUrl)

    // Open URL in external browser
    await shell.openExternal(authUrl)

    // Return the URL for UI to show (optional)
    return authUrl
  }

  // 9. Complete OAuth flow with manual code input
  public async completeOAuthWithCode(code: string): Promise<string> {
    if (!this.currentPKCE) {
      throw new Error('OAuth flow not started. Please call startOAuthFlow first.')
    }

    try {
      // Exchange code for tokens using stored PKCE verifier
      const credentials = await this.exchangeCodeForTokens(code, this.currentPKCE.verifier)
      await this.saveCredentials(credentials)

      // Clear stored PKCE after successful exchange
      this.currentPKCE = null

      return credentials.access_token
    } catch (error) {
      logger.error('OAuth code exchange failed:', error as Error)
      // Clear PKCE on error
      this.currentPKCE = null
      throw error
    }
  }

  // 10. Cancel current OAuth flow
  public cancelOAuthFlow(): void {
    if (this.currentPKCE) {
      logger.info('Cancelling OAuth flow')
      this.currentPKCE = null
    }
  }

  // 11. Clear stored credentials
  public async clearCredentials(): Promise<void> {
    try {
      await promises.unlink(CREDS_PATH)
      logger.info('Credentials cleared')
    } catch (error) {
      // File doesn't exist, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  // 12. Check if credentials exist (env var, own store, or Claude Code fallback)
  public async hasCredentials(): Promise<boolean> {
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return true
    const creds = await this.loadCredentials()
    if (creds) return true
    const claudeCreds = await this.loadClaudeCodeCredentials()
    return claudeCreds !== null
  }
}

export default new AnthropicService()
