import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CodexCliService } from '../CodexCliService'

describe('CodexCliService', () => {
  const existingFiles = new Set<string>()

  beforeEach(() => {
    existingFiles.clear()
    vi.mocked(fs.existsSync).mockImplementation((filePath) => existingFiles.has(String(filePath)))
    vi.mocked(fs.statSync).mockImplementation(
      () =>
        ({
          isFile: () => true
        }) as fs.Stats
    )
  })

  it('resolves an explicit configured Codex executable first', async () => {
    const binaryPath = path.join('/tmp/codex-configured', process.platform === 'win32' ? 'codex.exe' : 'codex')
    existingFiles.add(binaryPath)

    const service = new CodexCliService({
      developmentBinaryPath: () => undefined,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never
    })

    await expect(
      service.resolveBinary({
        kind: 'codex',
        mode: 'managed',
        sidecar: {
          binaryPath
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        path: binaryPath,
        source: 'configured',
        state: 'ready'
      })
    )
  })

  it('resolves verified managed Codex binaries before development checkouts', async () => {
    const binaryPath = path.join('/tmp/managed-codex', process.platform === 'win32' ? 'codex.exe' : 'codex')
    existingFiles.add(binaryPath)

    const service = new CodexCliService({
      developmentBinaryPath: () => undefined,
      managedRuntimeService: createManagedRuntimeService(binaryPath) as never,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never
    })

    await expect(service.resolveBinary({ kind: 'codex', mode: 'managed' })).resolves.toEqual(
      expect.objectContaining({
        path: binaryPath,
        source: 'managed',
        state: 'ready'
      })
    )
  })

  it('resolves detected PATH Codex binaries before managed binaries', async () => {
    const detectedPath = path.join('/tmp/path-codex', process.platform === 'win32' ? 'codex.exe' : 'codex')
    const managedPath = path.join('/tmp/managed-codex', process.platform === 'win32' ? 'codex.exe' : 'codex')
    existingFiles.add(detectedPath)
    existingFiles.add(managedPath)

    const service = new CodexCliService({
      developmentBinaryPath: () => undefined,
      managedRuntimeService: createManagedRuntimeService(managedPath) as never,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService(detectedPath) as never
    })

    await expect(service.resolveBinary({ kind: 'codex', mode: 'managed' })).resolves.toEqual(
      expect.objectContaining({
        path: detectedPath,
        source: 'path',
        state: 'ready',
        message: expect.stringContaining('detected on PATH')
      })
    )
  })

  it('returns a clear missing-binary status when no executable can be found', async () => {
    const service = new CodexCliService({
      developmentBinaryPath: () => undefined,
      managedRuntimeService: createManagedRuntimeService() as never,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never
    })

    await expect(service.resolveBinary({ kind: 'codex', mode: 'managed' })).resolves.toEqual(
      expect.objectContaining({
        state: 'missing-binary',
        message: expect.stringContaining('Codex CLI executable was not found')
      })
    )
  })

  it('lists Codex models through codex app-server model/list', async () => {
    const binaryPath = '/tmp/codex'
    existingFiles.add(binaryPath)
    const spawnProcess = vi.fn(() => createMockAppServerProcess())
    const service = new CodexCliService({
      developmentBinaryPath: () => binaryPath,
      managedRuntimeService: createManagedRuntimeService() as never,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never,
      spawnProcess: spawnProcess as never
    })

    await expect(service.listModels({ kind: 'codex', mode: 'managed' })).resolves.toEqual([
      {
        id: 'gpt-5.5',
        model: 'gpt-5.5',
        displayName: 'GPT-5.5',
        description: undefined,
        hidden: false,
        isDefault: true,
        supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
        defaultReasoningEffort: 'medium'
      },
      {
        id: 'gpt-5.2-codex',
        model: 'gpt-5.2-codex',
        displayName: 'GPT-5.2 Codex',
        description: 'Codex model',
        hidden: false,
        isDefault: false,
        supportedReasoningEfforts: ['low', 'medium', 'high'],
        defaultReasoningEffort: 'medium'
      }
    ])
    expect(spawnProcess).toHaveBeenCalledWith(binaryPath, ['app-server', '--listen', 'stdio://'], expect.any(Object))
  })

  it('normalizes CLI-provided gpt-5.5 as the visible default model', async () => {
    const binaryPath = '/tmp/codex'
    existingFiles.add(binaryPath)
    const spawnProcess = vi.fn(() =>
      createMockAppServerProcess([
        {
          id: 'gpt-5.5',
          model: 'gpt-5.5',
          displayName: 'GPT-5.5 Preview',
          hidden: true,
          isDefault: false,
          supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
          defaultReasoningEffort: 'high'
        }
      ])
    )
    const service = new CodexCliService({
      developmentBinaryPath: () => binaryPath,
      managedRuntimeService: createManagedRuntimeService() as never,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never,
      spawnProcess: spawnProcess as never
    })

    await expect(service.listModels({ kind: 'codex', mode: 'managed' })).resolves.toEqual([
      {
        id: 'gpt-5.5',
        model: 'gpt-5.5',
        displayName: 'GPT-5.5 Preview',
        description: undefined,
        hidden: false,
        isDefault: true,
        supportedReasoningEfforts: ['high'],
        defaultReasoningEffort: 'high'
      }
    ])
  })
})

function createMockAppServerProcess(
  models: Array<Record<string, unknown>> = [
    {
      id: 'gpt-5.2-codex',
      model: 'gpt-5.2-codex',
      displayName: 'GPT-5.2 Codex',
      description: 'Codex model',
      hidden: false,
      isDefault: true,
      supportedReasoningEfforts: [
        { reasoningEffort: 'low' },
        { reasoningEffort: 'medium' },
        { reasoningEffort: 'high' }
      ],
      defaultReasoningEffort: 'medium'
    }
  ]
) {
  const child = new EventEmitter() as any
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn(() => {
    child.stdout.end()
    child.stderr.end()
    child.emit('exit', 0, null)
  })

  child.stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (!line.trim()) continue
      const message = JSON.parse(line)
      if (message.method === 'initialize') {
        child.stdout.write(`${JSON.stringify({ id: message.id, result: { codexHome: '/tmp/codex' } })}\n`)
      }
      if (message.method === 'model/list') {
        child.stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: {
              data: models,
              nextCursor: null
            }
          })}\n`
        )
      }
    }
  })

  return child
}

function createManagedRuntimeService(binaryPath?: string) {
  return {
    resolveInstalledBinary: vi.fn(async () => ({
      binaryPath,
      status: {
        name: 'codex',
        version: '1.0.0',
        platform: `${process.platform}-${process.arch}`,
        state: binaryPath ? ('installed' as const) : ('missing' as const),
        binaryPath,
        message: binaryPath ? 'installed' : 'missing'
      }
    }))
  }
}

function createRuntimeBinaryDiscoveryService(detectedPath?: string) {
  return {
    discover: vi.fn(async () => ({
      kind: 'codex',
      command: 'codex',
      detectedPath,
      version: detectedPath ? 'codex 1.0.0' : undefined,
      source: 'path' as const,
      available: Boolean(detectedPath),
      message: detectedPath ? `codex was detected on PATH at ${detectedPath}.` : 'codex was not found on PATH.'
    }))
  }
}
