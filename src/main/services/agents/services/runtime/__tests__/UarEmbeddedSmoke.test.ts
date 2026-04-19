import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentStream, AgentStreamEvent } from '../../../interfaces/AgentStreamInterface'

const spawnMock = vi.fn()
const fetchMock = vi.fn()
let tempDir: string

vi.mock('node:fs', async (importOriginal) => importOriginal<typeof fs>())

vi.mock('node:os', async (importOriginal) => importOriginal<typeof os>())

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}))

vi.mock('electron', () => ({
  app: {
    once: vi.fn()
  }
}))

vi.mock('@main/utils', () => ({
  getDataPath: (subPath?: string) => {
    const dataPath = path.join(tempDir, 'Data', subPath ?? '')
    fs.mkdirSync(dataPath, { recursive: true })
    return dataPath
  },
  getResourcePath: () => path.join(tempDir, 'resources'),
  toAsarUnpackedPath: (filePath: string) => filePath
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn(async () => ({
    valid: true,
    modelId: 'gpt-5.2',
    provider: {
      id: 'openai',
      type: 'openai',
      apiKey: 'test-key',
      apiHost: 'https://api.openai.com'
    }
  }))
}))

import { UarRuntimeAdapter } from '../UarRuntimeAdapter'
import { universalAgentRuntimeService } from '../UniversalAgentRuntimeService'

describe('embedded UAR smoke path', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uar-smoke-test-'))
    vi.clearAllMocks()
    global.fetch = fetchMock

    const binaryPath = path.join(tempDir, 'resources', 'binaries', `${process.platform}-${process.arch}`, binaryName())
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true })
    fs.writeFileSync(binaryPath, '')
    spawnMock.mockReturnValue(createChildProcess())
    fetchMock.mockImplementation((input: URL | string) => {
      const url = input instanceof URL ? input : new URL(String(input))
      if (url.pathname === '/healthz' || url.pathname === '/readyz') {
        return Promise.resolve(new Response('{}', { status: 200 }))
      }
      if (url.pathname === '/v1/models') {
        return Promise.resolve(jsonResponse({ data: [{ id: 'gpt-5.2' }] }))
      }
      if (url.pathname === '/v1/chat/completions') {
        return Promise.resolve(
          sseResponse('data: {"choices":[{"delta":{"content":"UAR smoke response"}}]}\n\ndata: [DONE]\n\n')
        )
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
  })

  afterEach(async () => {
    await universalAgentRuntimeService.stop()
    vi.restoreAllMocks()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('starts the sidecar, verifies health endpoints, sends chat through the adapter, emits telemetry, and stops', async () => {
    const adapter = new UarRuntimeAdapter()
    const stream = await adapter.invoke('smoke test', createSession(), new AbortController())

    const events = await collectEvents(stream)

    expect(spawnMock).toHaveBeenCalledWith(
      expect.stringContaining(binaryName()),
      ['--config', expect.stringContaining('config.generated.yaml')],
      expect.any(Object)
    )
    expect(fetchMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/healthz' }), expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/readyz' }), expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/v1/chat/completions', 'http://127.0.0.1:1906'),
      expect.objectContaining({ method: 'POST' })
    )
    expect(textDeltas(events)).toContain('UAR smoke response')
    expect(
      events.some((event) => event.type === 'chunk' && (event.chunk as any)?.type === 'data-agent-runtime-event')
    ).toBe(true)

    await universalAgentRuntimeService.stop()
    expect(spawnMock.mock.results[0].value.kill).toHaveBeenCalled()
  })
})

function createSession(): any {
  return {
    id: 'session-id',
    agent_id: 'agent-id',
    name: 'UAR Smoke',
    model: 'openai:gpt-5.2',
    accessible_paths: ['/tmp/workspace'],
    configuration: {
      runtime: {
        kind: 'uar',
        mode: 'embedded',
        sidecar: {
          port: 1906
        }
      }
    }
  }
}

function binaryName(): string {
  return process.platform === 'win32' ? 'universal-agent-runtime.exe' : 'universal-agent-runtime'
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json'
    }
  })
}

function sseResponse(text: string): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text))
        controller.close()
      }
    }),
    {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'x-uar-session-id': 'uar-session-id'
      }
    }
  )
}

function collectEvents(stream: AgentStream): Promise<AgentStreamEvent[]> {
  return new Promise((resolve) => {
    const events: AgentStreamEvent[] = []
    stream.on('data', (event) => {
      events.push(event)
      if (event.type === 'complete' || event.type === 'error' || event.type === 'cancelled') {
        resolve(events)
      }
    })
  })
}

function textDeltas(events: AgentStreamEvent[]): string[] {
  return events
    .filter((event) => event.type === 'chunk' && event.chunk?.type === 'text-delta')
    .map((event) => (event.chunk as any).text)
}

function createChildProcess(): any {
  const child = new EventEmitter() as any
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = vi.fn(() => {
    child.killed = true
    queueMicrotask(() => child.emit('exit', 0, null))
    return true
  })
  return child
}
