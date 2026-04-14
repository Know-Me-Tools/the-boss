/**
 * Test script: exercises the OpenAI OAuth fetch handler the same way
 * OpenAIOAuthService.handleInternalRequest() does in the app.
 *
 * Run with:
 *   node scripts/test-openai-oauth-sdk.mjs
 *
 * What it does:
 *   1. Locates ~/.codex/auth.json (same path resolution as OpenAIOAuthService)
 *   2. Creates a fetch handler via createOpenAIOAuthFetchHandler({ authFilePath })
 *   3. Sends a streaming chat completion request through that handler
 *   4. Reads and prints each SSE chunk as it arrives
 */

import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ---------------------------------------------------------------------------
// 1. Locate auth.json (mirrors OpenAIOAuthService.resolveAuthFilePath)
// ---------------------------------------------------------------------------
const candidates = [
  process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, 'auth.json') : null,
  path.join(os.homedir(), '.codex', 'auth.json')
].filter(Boolean)

const authFilePath = candidates.find((p) => existsSync(p)) ?? null

if (!authFilePath) {
  console.error('ERROR: No auth.json found. Tried:')
  candidates.forEach((p) => console.error(' ', p))
  process.exit(1)
}

console.log('Auth file:', authFilePath)

// Verify it has token content (mirrors OpenAIOAuthService.containsTokenValue check)
const raw = JSON.parse(await fs.readFile(authFilePath, 'utf-8'))
const tokens = raw?.tokens ?? {}
const hasToken = Object.values(tokens).some((v) => typeof v === 'string' && v.length > 20)
if (!hasToken) {
  console.error('ERROR: auth.json does not appear to contain usable token values.')
  process.exit(1)
}
console.log('Auth file tokens present:', Object.keys(tokens).join(', '))

// ---------------------------------------------------------------------------
// 2. Create the fetch handler (same call as OpenAIOAuthService.getInternalFetchHandler)
// ---------------------------------------------------------------------------
const { createOpenAIOAuthFetchHandler } = await import('openai-oauth')

const handler = createOpenAIOAuthFetchHandler({
  authFilePath,
  requestLogger: (event) => {
    if (event.type === 'chat_error') {
      console.error('[openai-oauth] error:', event.message)
    } else {
      console.log(`[openai-oauth] ${event.type}`, JSON.stringify(event))
    }
  }
})

console.log('\nFetch handler created ✓')

// ---------------------------------------------------------------------------
// 3. Build a streaming chat completion request
//    The handler expects a Request with URL http://internal/v1/chat/completions
//    (same fake internal URL used by openAIOAuthInternalRoutes)
// ---------------------------------------------------------------------------
const requestBody = {
  model: 'gpt-5.4',
  stream: true,
  messages: [
    {
      role: 'user',
      content: 'Say "Hello from OpenAI OAuth via openai-oauth library!" and nothing else.'
    }
  ]
}

console.log('\nSending streaming request...')
console.log('─'.repeat(60))

const request = new Request('http://internal/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(requestBody)
})

// ---------------------------------------------------------------------------
// 4. Call the handler and stream the response
// ---------------------------------------------------------------------------
let response
try {
  response = await handler(request)
} catch (err) {
  console.error('ERROR calling handler:', err.message)
  process.exit(1)
}

console.log('HTTP status:', response.status)

if (!response.ok) {
  const body = await response.text()
  console.error('ERROR response body:', body)
  process.exit(1)
}

if (!response.body) {
  console.error('ERROR: response has no body')
  process.exit(1)
}

// Read SSE stream
const decoder = new TextDecoder()
const reader = response.body.getReader()
let fullText = ''
let chunkCount = 0

try {
  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    const lines = chunk.split('\n')

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const delta = parsed?.choices?.[0]?.delta?.content
        if (delta) {
          process.stdout.write(delta)
          fullText += delta
        }
        chunkCount++
      } catch {
        // non-JSON data line, skip
      }
    }
  }
} finally {
  reader.releaseLock()
}

console.log('\n' + '─'.repeat(60))
console.log('\nSUCCESS')
console.log('  SSE chunks received:', chunkCount)
console.log('  Full text:', fullText.trim())
