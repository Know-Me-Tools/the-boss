/**
 * Test script: exercises the exact same credential + query() flow used by
 * /_internal/anthropic-oauth (src/main/apiServer/routes/internal/anthropicOAuth.ts)
 *
 * Run with:
 *   node scripts/test-anthropic-oauth-sdk.mjs
 *
 * What it does:
 *   1. Reads OAuth credentials from ~/.claude/credentials.json (Claude Code's format)
 *   2. Writes them to a temp CLAUDE_CONFIG_DIR/credentials.json in the same format
 *   3. Calls query() from @anthropic-ai/claude-agent-sdk — no ANTHROPIC_AUTH_TOKEN,
 *      no ANTHROPIC_BASE_URL — letting Claude Code use its own internal auth path
 *   4. Streams back SDKMessage events and prints each chunk as it arrives
 */

import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

// ---------------------------------------------------------------------------
// Resolve claude-agent-sdk and cli.js the same way the route does
// ---------------------------------------------------------------------------
const require_ = createRequire(import.meta.url)
const sdkDir = path.dirname(require_.resolve('@anthropic-ai/claude-agent-sdk'))
const cliPath = path.join(sdkDir, 'cli.js')

const { query } = await import('@anthropic-ai/claude-agent-sdk')

console.log('Claude Code CLI path:', cliPath)

// ---------------------------------------------------------------------------
// 1. Read credentials from ~/.claude/credentials.json
// ---------------------------------------------------------------------------
const CLAUDE_CODE_CREDS = path.join(os.homedir(), '.claude', 'credentials.json')

let rawFile
try {
  rawFile = JSON.parse(await fs.readFile(CLAUDE_CODE_CREDS, 'utf-8'))
} catch (err) {
  console.error('ERROR: Could not read ~/.claude/credentials.json:', err.message)
  process.exit(1)
}

const oauth = rawFile?.oauth
if (!oauth?.accessToken || !oauth?.refreshToken) {
  console.error('ERROR: credentials.json missing oauth.accessToken or oauth.refreshToken')
  process.exit(1)
}

console.log('Credentials loaded from ~/.claude/credentials.json')
console.log('  accessToken: present ✓')
console.log('  refreshToken: present ✓')
console.log('  expiresAt:', oauth.expiresAt ?? 'null (no expiry)')

// ---------------------------------------------------------------------------
// 2. Write credentials to a temp CLAUDE_CONFIG_DIR in Claude Code format
// ---------------------------------------------------------------------------
const tempConfigDir = path.join(os.tmpdir(), 'cherry-studio-oauth-test-' + Date.now())
await fs.mkdir(tempConfigDir, { recursive: true })

const claudeCredsPayload = {
  oauth: {
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    expiresAt: oauth.expiresAt ?? null
  }
}

await fs.writeFile(
  path.join(tempConfigDir, 'credentials.json'),
  JSON.stringify(claudeCredsPayload, null, 2)
)

console.log('\nWrote credentials to temp CLAUDE_CONFIG_DIR:', tempConfigDir)

// ---------------------------------------------------------------------------
// 3. Call query() — same env as the route (no ANTHROPIC_AUTH_TOKEN, no ANTHROPIC_BASE_URL)
// ---------------------------------------------------------------------------
const prompt = 'Say "Hello from Claude Max OAuth via Claude Code SDK!" and nothing else.'

console.log('\nSending prompt:', prompt)
console.log('─'.repeat(60))

const sdkQuery = query({
  prompt,
  options: {
    model: 'claude-opus-4-6',
    maxTurns: 1,
    tools: [],
    allowedTools: [],
    includePartialMessages: true,
    persistSession: false,
    permissionMode: 'dontAsk',
    pathToClaudeCodeExecutable: cliPath,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: '',
      // DO NOT set ANTHROPIC_AUTH_TOKEN — that routes to api.anthropic.com which rejects OAuth
      // DO NOT set ANTHROPIC_BASE_URL — let Claude Code use its own routing
      CLAUDE_CODE_USE_BEDROCK: '0',
      CLAUDE_CONFIG_DIR: tempConfigDir
    }
  }
})

// ---------------------------------------------------------------------------
// 4. Stream events and print progress
// ---------------------------------------------------------------------------
let fullText = ''
let inputTokens = 0
let outputTokens = 0
let eventCount = 0

try {
  for await (const message of sdkQuery) {
    eventCount++

    if (message.type === 'stream_event') {
      const ev = message.event
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        process.stdout.write(ev.delta.text)
        fullText += ev.delta.text
      } else if (ev.type === 'message_start') {
        process.stdout.write('[stream_start] ')
      } else if (ev.type === 'message_stop') {
        process.stdout.write('\n[stream_stop]\n')
      }
    } else if (message.type === 'assistant') {
      // Non-streaming accumulation path
      for (const block of message.message?.content ?? []) {
        if (block.type === 'text') {
          fullText += block.text
        }
      }
    } else if (message.type === 'result') {
      if (message.subtype === 'success') {
        inputTokens = message.usage?.input_tokens ?? 0
        outputTokens = message.usage?.output_tokens ?? 0
      } else if (message.subtype === 'error') {
        console.error('\n\nSDK error result:', message.error)
      }
    } else if (message.type === 'system') {
      // system messages (claude_code_version, model, etc.)
    }
  }

  console.log('─'.repeat(60))
  console.log('\nSUCCESS')
  console.log('  Events received:', eventCount)
  console.log('  Full text:', fullText.trim() || '(empty)')
  console.log('  Tokens — input:', inputTokens, '/ output:', outputTokens)
} catch (err) {
  console.error('\n\nERROR during streaming:', err.message)
  process.exit(1)
} finally {
  // Clean up temp dir
  await fs.rm(tempConfigDir, { recursive: true, force: true })
  console.log('\nCleaned up temp config dir.')
}
