/**
 * Test script: exercises the internal OpenAI OAuth route the same way
 * forwardInternalRequest() does in the app — without needing the HTTP server.
 *
 * Run with:
 *   node scripts/test-openai-oauth-proxy.mjs
 *
 * What it does:
 *   1. Locates ~/.codex/auth.json (same as OpenAIOAuthService)
 *   2. Creates the fetch handler via createOpenAIOAuthFetchHandler({ authFilePath })
 *   3. Strips problematic headers (host, content-length, etc.) — mirrors forwardInternalRequest
 *   4. Sends a streaming chat completion request through the handler
 *   5. Reads and prints each SSE chunk — mirrors writeFetchResponse + bodyStream.pipe(res)
 *
 * This confirms that the proxy logic (header filtering, request construction,
 * stream piping) works end-to-end before the app is running.
 */

import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

// ---------------------------------------------------------------------------
// 1. Locate auth.json
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

const raw = JSON.parse(await fs.readFile(authFilePath, 'utf-8'))
const tokens = raw?.tokens ?? {}
const hasToken = Object.values(tokens).some((v) => typeof v === 'string' && v.length > 20)
if (!hasToken) {
  console.error('ERROR: auth.json does not contain usable token values.')
  process.exit(1)
}
console.log('Auth file tokens present:', Object.keys(tokens).join(', '))

// ---------------------------------------------------------------------------
// 2. Create the fetch handler (mirrors OpenAIOAuthService.getInternalFetchHandler)
// ---------------------------------------------------------------------------
const { createOpenAIOAuthFetchHandler } = await import('openai-oauth')

const handler = createOpenAIOAuthFetchHandler({
  authFilePath,
  requestLogger: (event) => {
    if (event.type === 'chat_error') {
      console.error('[openai-oauth] chat_error:', JSON.stringify(event))
    } else {
      console.log(`[openai-oauth] ${event.type}:`, JSON.stringify(event))
    }
  }
})

console.log('\nFetch handler created ✓')

// ---------------------------------------------------------------------------
// 3. Build request — mirrors forwardInternalRequest header filtering + body serialisation
//
//    Headers that forwardInternalRequest strips:
//      host, connection, content-length, transfer-encoding,
//      x-cherry-openai-oauth-secret, x-cherry-anthropic-oauth-secret
//
//    Here we simulate the incoming headers a renderer would send.
// ---------------------------------------------------------------------------
const REQUEST_HEADERS_TO_STRIP = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'x-cherry-openai-oauth-secret',
  'x-cherry-anthropic-oauth-secret'
])

const simulatedIncomingHeaders = {
  'content-type': 'application/json',
  authorization: 'Bearer oauth', // local API key from renderer
  'x-cherry-openai-oauth-secret': 'should-be-stripped',
  host: '127.0.0.1:23334',
  connection: 'keep-alive',
  'content-length': '999' // will be wrong — should be stripped and re-calculated
}

const filteredHeaders = new Headers()
for (const [key, value] of Object.entries(simulatedIncomingHeaders)) {
  if (REQUEST_HEADERS_TO_STRIP.has(key.toLowerCase())) {
    console.log(`  stripped header: ${key}`)
    continue
  }
  filteredHeaders.set(key, value)
}

const requestBody = {
  model: 'gpt-5.4',
  stream: true,
  messages: [
    {
      role: 'user',
      content: 'Say "OpenAI OAuth proxy route working!" and nothing else.'
    }
  ]
}

const body = JSON.stringify(requestBody)
// content-length is stripped; we let fetch calculate it
filteredHeaders.set('content-type', 'application/json')

const request = new Request('http://internal/v1/chat/completions', {
  method: 'POST',
  headers: filteredHeaders,
  body,
  duplex: 'half'
})

console.log('\nSending request through handler (model: gpt-5.4, stream: true)')
console.log('─'.repeat(60))

// ---------------------------------------------------------------------------
// 4. Call handler — mirrors openAIOAuthService.handleInternalRequest(request)
// ---------------------------------------------------------------------------
let upstreamResponse
try {
  upstreamResponse = await handler(request)
} catch (err) {
  console.error('ERROR: handler threw:', err.message)
  process.exit(1)
}

console.log('Upstream HTTP status:', upstreamResponse.status)

if (!upstreamResponse.ok) {
  const errorText = await upstreamResponse.text()
  console.error('ERROR: upstream non-OK response:', errorText.slice(0, 500))
  process.exit(1)
}

if (!upstreamResponse.body) {
  console.error('ERROR: upstream response has no body')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 5. Pipe the response body — mirrors writeFetchResponse + bodyStream.pipe(res)
//    Instead of piping to an Express Response, we pipe to stdout.
// ---------------------------------------------------------------------------
const bodyStream = Readable.fromWeb(upstreamResponse.body)

let chunkCount = 0
let fullText = ''
let pipeError = null

await new Promise((resolve, reject) => {
  bodyStream.on('error', (err) => {
    console.error('\n[pipe] Stream error:', err.message)
    pipeError = err
    resolve() // mirrors safeEnd() — don't throw, just end
  })

  bodyStream.on('data', (chunk) => {
    const text = chunk.toString('utf-8')
    const lines = text.split('\n')

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
        // non-JSON SSE line — skip
      }
    }
  })

  bodyStream.on('end', resolve)
})

console.log('\n' + '─'.repeat(60))

if (pipeError) {
  console.error('\nFAILED — stream errored mid-way')
  console.error('Error:', pipeError.message)
  process.exit(1)
}

console.log('\nSUCCESS ✓')
console.log('  SSE chunks received:', chunkCount)
console.log('  Full text:', fullText.trim())
