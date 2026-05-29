import { type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as fsAsync from 'node:fs/promises'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildOpenCodeGlobalConfigFromCherryProviders, OpenCodeCliService } from '../OpenCodeCliService'
import type { SupervisedHandle, SupervisedSpawnSpec } from '../SidecarProcessSupervisor'

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => process.cwd()),
    getPath: vi.fn(() => '/tmp'),
    isPackaged: false,
    once: vi.fn()
  }
}))

vi.mock('@main/apiServer/utils', () => ({
  getAvailableProviders: vi.fn(async () => [])
}))

let mockFiles: Map<string, string>

describe('OpenCodeCliService', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fsAsync.mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'opencode-cli-service-'))
    mockFiles = new Map()
    vi.mocked(fs.existsSync).mockImplementation((filePath) => mockFiles.has(String(filePath)))
    vi.mocked(fs.statSync).mockImplementation(
      (filePath) =>
        ({
          isFile: () => mockFiles.has(String(filePath))
        }) as fs.Stats
    )
  })

  afterEach(async () => {
    ;(app as any).isPackaged = false
    await fsAsync.rm(tempDir, { recursive: true, force: true })
  })

  it('resolves the development OpenCode binary path', async () => {
    const binaryPath = path.join(tempDir, 'vendor-opencode')
    await writeExecutable(binaryPath)
    const service = new OpenCodeCliService({
      developmentBinaryPath: () => binaryPath,
      managedRuntimeService: createManagedRuntimeService() as never,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never,
      homedir: () => tempDir
    })

    await expect(service.resolveBinary()).resolves.toEqual(
      expect.objectContaining({
        path: binaryPath,
        source: 'development',
        state: 'ready'
      })
    )
  })

  it('resolves a verified managed OpenCode binary path', async () => {
    const binaryPath = path.join(tempDir, 'managed-opencode', binaryName())
    await writeExecutable(binaryPath)
    const service = new OpenCodeCliService({
      developmentBinaryPath: () => undefined,
      managedRuntimeService: createManagedRuntimeService(binaryPath) as never,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never,
      homedir: () => tempDir
    })

    await expect(service.resolveBinary()).resolves.toEqual(
      expect.objectContaining({
        path: binaryPath,
        source: 'managed',
        state: 'ready'
      })
    )
  })

  it('prefers configured OpenCode binary paths before managed binaries', async () => {
    const configuredPath = path.join(tempDir, 'configured-opencode', binaryName())
    const managedPath = path.join(tempDir, 'managed-opencode', binaryName())
    await writeExecutable(configuredPath)
    await writeExecutable(managedPath)
    const service = new OpenCodeCliService({
      developmentBinaryPath: () => undefined,
      managedRuntimeService: createManagedRuntimeService(managedPath) as never,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never,
      homedir: () => tempDir
    })

    await expect(
      service.resolveBinary({
        kind: 'opencode',
        mode: 'managed',
        sidecar: {
          binaryPath: configuredPath
        }
      } as any)
    ).resolves.toEqual(
      expect.objectContaining({
        path: configuredPath,
        source: 'configured',
        state: 'ready'
      })
    )
  })

  it('prefers a verified managed OpenCode binary over a PATH binary by default', async () => {
    const detectedPath = path.join(tempDir, 'path-opencode', binaryName())
    const managedPath = path.join(tempDir, 'managed-opencode', binaryName())
    await writeExecutable(detectedPath)
    await writeExecutable(managedPath)
    const service = new OpenCodeCliService({
      developmentBinaryPath: () => undefined,
      managedRuntimeService: createManagedRuntimeService(managedPath) as never,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService(detectedPath) as never,
      homedir: () => tempDir
    })

    // No allowPathDiscovery flag: a stale PATH binary must not override the managed one.
    await expect(service.resolveBinary()).resolves.toEqual(
      expect.objectContaining({
        path: managedPath,
        source: 'managed',
        state: 'ready'
      })
    )
  })

  it('does not use a PATH OpenCode binary when discovery is disabled and no managed binary exists', async () => {
    const detectedPath = path.join(tempDir, 'path-opencode', binaryName())
    await writeExecutable(detectedPath)
    const discovery = createRuntimeBinaryDiscoveryService(detectedPath)
    const service = new OpenCodeCliService({
      developmentBinaryPath: () => undefined,
      managedRuntimeService: createManagedRuntimeService() as never,
      runtimeBinaryDiscoveryService: discovery as never,
      homedir: () => tempDir
    })

    await expect(service.resolveBinary()).resolves.toEqual(expect.objectContaining({ state: 'missing-binary' }))
    expect(discovery.discover).not.toHaveBeenCalled()
  })

  it('uses a PATH OpenCode binary when allowPathDiscovery is opted in and no managed binary exists', async () => {
    const detectedPath = path.join(tempDir, 'path-opencode', binaryName())
    await writeExecutable(detectedPath)
    const service = new OpenCodeCliService({
      developmentBinaryPath: () => undefined,
      managedRuntimeService: createManagedRuntimeService() as never,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService(detectedPath) as never,
      homedir: () => tempDir
    })

    await expect(
      service.resolveBinary({ kind: 'opencode', mode: 'managed', sidecar: { allowPathDiscovery: true } })
    ).resolves.toEqual(
      expect.objectContaining({
        path: detectedPath,
        source: 'path',
        state: 'ready',
        message: expect.stringContaining('detected on PATH')
      })
    )
  })

  it('returns a useful health error when the managed executable is missing', async () => {
    const service = new OpenCodeCliService({
      developmentBinaryPath: () => undefined,
      managedRuntimeService: createManagedRuntimeService() as never,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never,
      homedir: () => tempDir
    })

    await expect(service.resolveBinary()).resolves.toEqual(
      expect.objectContaining({
        state: 'missing-binary',
        message: expect.stringContaining('OpenCode executable was not found')
      })
    )
  })

  it('starts a mocked OpenCode server, reuses it, lists models, and disposes it', async () => {
    const binaryPath = path.join(tempDir, 'opencode')
    await writeExecutable(binaryPath)
    const child = createMockOpenCodeProcess()
    const spawnProcess = vi.fn(() => child)
    const client = createMockOpenCodeClient()
    const createOpencodeClient = vi.fn(() => client)
    const supervisor = createFakeSupervisor()
    const service = new OpenCodeCliService({
      developmentBinaryPath: () => binaryPath,
      managedRuntimeService: createManagedRuntimeService() as never,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never,
      spawnProcess,
      supervisor: supervisor as never,
      loadSdk: async () => ({ createOpencodeClient }) as any,
      homedir: () => tempDir,
      getAvailableProviders: async () => []
    })

    const first = await service.listModels({ kind: 'opencode', mode: 'managed' } as any, tempDir)
    const second = await service.listModels({ kind: 'opencode', mode: 'managed' } as any, tempDir)

    // The managed server spawn is routed through the supervisor.
    expect(supervisor.spawn).toHaveBeenCalledTimes(1)
    expect(supervisor.specs[0]).toEqual(
      expect.objectContaining({
        name: 'opencode',
        key: `${tempDir}:{}`,
        binaryPath
      })
    )
    // The actual spawn mechanism stays injectable and receives detached: true.
    expect(spawnProcess).toHaveBeenCalledTimes(1)
    expect(spawnProcess).toHaveBeenCalledWith(
      binaryPath,
      ['serve', '--hostname', '127.0.0.1', '--port', '0'],
      expect.objectContaining({
        cwd: tempDir,
        detached: true,
        env: expect.objectContaining({
          OPENCODE_CONFIG_CONTENT: '{}'
        })
      })
    )
    expect(createOpencodeClient).toHaveBeenCalledWith({ baseUrl: 'http://127.0.0.1:41234' })
    expect(first).toEqual(second)
    expect(first).toEqual([
      expect.objectContaining({
        id: 'openai/gpt-5.2',
        providerId: 'openai',
        modelId: 'gpt-5.2',
        providerName: 'OpenAI',
        isDefault: true
      })
    ])

    // dispose() delegates termination to the supervisor for each tracked server.
    await service.dispose()
    expect(supervisor.stop).toHaveBeenCalledTimes(1)
    expect(supervisor.stop).toHaveBeenCalledWith(supervisor.handles[0].id)
  })

  it('evicts a managed server from its map when the supervisor reports it exited', async () => {
    const binaryPath = path.join(tempDir, 'opencode')
    await writeExecutable(binaryPath)
    const spawnProcess = vi.fn(() => createMockOpenCodeProcess())
    const createOpencodeClient = vi.fn(() => createMockOpenCodeClient())
    const supervisor = createFakeSupervisor()
    const service = new OpenCodeCliService({
      developmentBinaryPath: () => binaryPath,
      managedRuntimeService: createManagedRuntimeService() as never,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never,
      spawnProcess,
      supervisor: supervisor as never,
      loadSdk: async () => ({ createOpencodeClient }) as any,
      homedir: () => tempDir,
      getAvailableProviders: async () => []
    })

    await service.listModels({ kind: 'opencode', mode: 'managed' } as any, tempDir)
    expect(supervisor.spawn).toHaveBeenCalledTimes(1)

    // Fire the supervisor onExit observer: the stale server entry must be evicted.
    supervisor.specs[0].onExit?.(0, null)

    // A subsequent resolve re-creates a fresh managed server (second spawn).
    service.clearModelCache()
    await service.listModels({ kind: 'opencode', mode: 'managed' } as any, tempDir)
    expect(supervisor.spawn).toHaveBeenCalledTimes(2)
  })

  it('creates global OpenCode config from Cherry providers when no usable config exists', async () => {
    const config = buildOpenCodeGlobalConfigFromCherryProviders([
      {
        id: 'openai',
        type: 'openai',
        name: 'OpenAI',
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com/v1',
        enabled: true,
        models: [{ id: 'gpt-5.2', name: 'GPT 5.2', provider: 'openai', group: 'OpenAI' }]
      } as any
    ])

    expect(config).toEqual(
      expect.objectContaining({
        model: 'openai/gpt-5.2',
        provider: expect.objectContaining({
          openai: expect.objectContaining({
            npm: '@ai-sdk/openai',
            options: {
              apiKey: 'test-key',
              baseURL: 'https://api.openai.com/v1'
            }
          })
        })
      })
    )
  })

  it('writes global OpenCode config from mocked Cherry providers before model listing', async () => {
    const binaryPath = path.join(tempDir, 'opencode')
    await writeExecutable(binaryPath)
    const service = new OpenCodeCliService({
      developmentBinaryPath: () => binaryPath,
      managedRuntimeService: createManagedRuntimeService() as never,
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never,
      spawnProcess: vi.fn(() => createMockOpenCodeProcess()),
      loadSdk: async () => ({ createOpencodeClient: vi.fn(() => createMockOpenCodeClient()) }) as any,
      homedir: () => tempDir,
      getAvailableProviders: async () => [
        {
          id: 'openai',
          type: 'openai',
          name: 'OpenAI',
          apiKey: 'test-key',
          apiHost: 'https://api.openai.com/v1',
          enabled: true,
          models: [{ id: 'gpt-5.2', name: 'GPT 5.2', provider: 'openai', group: 'OpenAI' }]
        } as any
      ]
    })

    await service.listModels({ kind: 'opencode', mode: 'managed' } as any, tempDir)
    const configPath = path.join(tempDir, '.config', 'opencode', 'opencode.json')
    const config = JSON.parse(await fsAsync.readFile(configPath, 'utf8'))

    expect(config).toEqual(
      expect.objectContaining({
        model: 'openai/gpt-5.2'
      })
    )
  })

  it('preserves remote endpoint behavior without spawning a managed server', async () => {
    const spawnProcess = vi.fn()
    const client = createMockOpenCodeClient()
    const createOpencodeClient = vi.fn(() => client)
    const service = new OpenCodeCliService({
      spawnProcess,
      loadSdk: async () => ({ createOpencodeClient }) as any,
      homedir: () => tempDir
    })

    const models = await service.listModels(
      {
        kind: 'opencode',
        mode: 'remote',
        endpoint: 'http://127.0.0.1:4096',
        authRef: 'token'
      } as any,
      tempDir
    )

    expect(spawnProcess).not.toHaveBeenCalled()
    expect(createOpencodeClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:4096',
        directory: tempDir,
        headers: {
          authorization: 'Bearer token'
        }
      })
    )
    expect(models[0].id).toBe('openai/gpt-5.2')
  })
})

async function writeExecutable(filePath: string): Promise<void> {
  await fsAsync.mkdir(path.dirname(filePath), { recursive: true })
  await fsAsync.writeFile(filePath, '#!/bin/sh\n', 'utf8')
  await fsAsync.chmod(filePath, 0o755)
  mockFiles.set(filePath, '#!/bin/sh\n')
}

function createMockOpenCodeProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    kill: vi.fn(() => {
      ;(child as any).killed = true
      return true
    })
  })
  setImmediate(() => {
    ;(child.stdout as PassThrough).write('opencode server listening on http://127.0.0.1:41234\n')
  })
  return child
}

function createMockOpenCodeClient() {
  return {
    config: {
      get: vi.fn(async () => ({ data: { model: 'openai/gpt-5.2' } })),
      providers: vi.fn(async () => ({
        data: {
          default: { openai: 'gpt-5.2' },
          providers: [
            {
              id: 'openai',
              name: 'OpenAI',
              models: {
                'gpt-5.2': {
                  id: 'gpt-5.2',
                  name: 'GPT 5.2',
                  capabilities: {
                    reasoning: true,
                    toolcall: true
                  }
                }
              }
            }
          ]
        }
      }))
    }
  }
}

function binaryName(): string {
  return process.platform === 'win32' ? 'opencode.exe' : 'opencode'
}

interface FakeSupervisor {
  spawn: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  specs: SupervisedSpawnSpec[]
  handles: SupervisedHandle[]
}

function createFakeSupervisor(): FakeSupervisor {
  const specs: SupervisedSpawnSpec[] = []
  const handles: SupervisedHandle[] = []
  const fake: FakeSupervisor = {
    specs,
    handles,
    spawn: vi.fn((spec: SupervisedSpawnSpec): SupervisedHandle => {
      specs.push(spec)
      const child = spec.spawn()
      const id = `${spec.name}:${spec.key ?? 'default'}`
      const handle: SupervisedHandle = {
        id,
        process: child,
        status: () =>
          ({
            id,
            name: spec.name,
            key: spec.key,
            pid: child.pid,
            binaryPath: spec.binaryPath,
            cwd: spec.cwd,
            startedAt: Date.now(),
            state: 'running',
            restartCount: 0,
            recentStderr: []
          }) as never
      }
      handles.push(handle)
      return handle
    }),
    stop: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined)
  }
  return fake
}

function createManagedRuntimeService(binaryPath?: string) {
  return {
    resolveInstalledBinary: vi.fn(async () => ({
      binaryPath,
      status: {
        name: 'opencode',
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
      kind: 'opencode',
      command: 'opencode',
      detectedPath,
      version: detectedPath ? 'opencode 1.0.0' : undefined,
      source: 'path' as const,
      available: Boolean(detectedPath),
      message: detectedPath ? `opencode was detected on PATH at ${detectedPath}.` : 'opencode was not found on PATH.'
    }))
  }
}
