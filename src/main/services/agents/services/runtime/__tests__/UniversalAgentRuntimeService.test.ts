import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SidecarProcessSupervisor, SupervisedHandle, SupervisedSpawnSpec } from '../SidecarProcessSupervisor'
import { UniversalAgentRuntimeService } from '../UniversalAgentRuntimeService'

const spawnMock = vi.fn()
const fetchMock = vi.fn()
let tempDir: string

vi.mock('node:fs', async (importOriginal) => importOriginal<typeof fs>())

vi.mock('node:os', async (importOriginal) => importOriginal<typeof os>())

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
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

describe('UniversalAgentRuntimeService', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uar-service-test-'))
    vi.clearAllMocks()
    global.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('reports a clear error when the sidecar binary is missing', async () => {
    const service = new UniversalAgentRuntimeService({
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never
    })

    await expect(service.ensureRunning({ kind: 'uar', mode: 'embedded' })).rejects.toThrow(
      'UAR embedded sidecar binary is missing'
    )
  })

  it('generates config, starts the sidecar, waits for health, and stops it', async () => {
    const binaryPath = path.join(tempDir, 'managed-uar', binaryName())
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true })
    fs.writeFileSync(binaryPath, '')

    const child = createChildProcess()
    spawnMock.mockReturnValue(child)
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    const fakeSupervisor = createFakeSupervisor()
    const service = new UniversalAgentRuntimeService({
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never,
      supervisor: fakeSupervisor.supervisor as never
    })
    const endpoint = await service.ensureRunning(
      {
        kind: 'uar',
        mode: 'embedded',
        sidecar: {
          binaryPath
        }
      },
      {
        providerId: 'openai',
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com',
        modelId: 'gpt-5.2'
      }
    )

    expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    // Spawning is routed through the supervisor with the UAR sidecar name and a
    // spawn thunk; the thunk is what records the underlying spawn options.
    expect(fakeSupervisor.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'universal-agent-runtime',
        binaryPath,
        spawn: expect.any(Function)
      })
    )
    expect(spawnMock).toHaveBeenCalledWith(
      binaryPath,
      ['--config', expect.stringContaining('config.generated.yaml')],
      expect.objectContaining({
        cwd: path.join(tempDir, 'Data', 'uar'),
        // detached lets the supervisor kill the whole process group via tree-kill.
        detached: true,
        env: expect.objectContaining({
          LLM_API_KEY: 'test-key',
          LLM_MODEL: 'gpt-5.2',
          UAR_NATIVE_TOOLS__FILE_TOOLS_ENABLED: 'false'
        })
      })
    )

    const configPath = spawnMock.mock.calls[0][1][1]
    const config = fs.readFileSync(configPath, 'utf8')
    expect(config).toContain('database_url: "rocksdb://')
    expect(config).toContain('upload_dir:')
    expect(config).toContain('file_tools_enabled: false')

    await service.stop()

    // stop() delegates termination to the supervisor using the handle id.
    expect(fakeSupervisor.stop).toHaveBeenCalledWith(fakeSupervisor.lastHandle?.id)
    expect(fakeSupervisor.lastHandle?.id).toBe('universal-agent-runtime:default')
  })

  it('uses a verified managed app-data binary', async () => {
    const managedPath = path.join(
      tempDir,
      'Data',
      'managed-binaries',
      'universal-agent-runtime',
      '1.0.0',
      `${process.platform}-${process.arch}`,
      binaryName()
    )
    fs.mkdirSync(path.dirname(managedPath), { recursive: true })
    fs.writeFileSync(managedPath, '')

    const child = createChildProcess()
    spawnMock.mockReturnValue(child)
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    const fakeSupervisor = createFakeSupervisor()
    const service = new UniversalAgentRuntimeService({
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never,
      supervisor: fakeSupervisor.supervisor as never,
      managedBinaryService: {
        resolveInstalledBinary: vi.fn(async () => ({
          binaryPath: managedPath,
          status: {
            name: 'universal-agent-runtime',
            version: '1.0.0',
            platform: `${process.platform}-${process.arch}`,
            state: 'installed' as const,
            binaryPath: managedPath,
            message: 'installed'
          }
        }))
      }
    })

    await service.ensureRunning({ kind: 'uar', mode: 'embedded' })

    expect(spawnMock).toHaveBeenCalledWith(managedPath, expect.any(Array), expect.any(Object))
    await service.stop()
  })

  it('prefers a verified managed app-data binary over a detected PATH binary by default', async () => {
    const detectedPath = path.join(tempDir, 'path-uar', binaryName())
    const managedPath = path.join(
      tempDir,
      'Data',
      'managed-binaries',
      'universal-agent-runtime',
      '1.0.0',
      `${process.platform}-${process.arch}`,
      binaryName()
    )
    fs.mkdirSync(path.dirname(detectedPath), { recursive: true })
    fs.mkdirSync(path.dirname(managedPath), { recursive: true })
    fs.writeFileSync(detectedPath, '')
    fs.writeFileSync(managedPath, '')

    const child = createChildProcess()
    spawnMock.mockReturnValue(child)
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    const discovery = createRuntimeBinaryDiscoveryService(detectedPath)
    const fakeSupervisor = createFakeSupervisor()
    const service = new UniversalAgentRuntimeService({
      runtimeBinaryDiscoveryService: discovery as never,
      supervisor: fakeSupervisor.supervisor as never,
      managedBinaryService: {
        resolveInstalledBinary: vi.fn(async () => ({
          binaryPath: managedPath,
          status: {
            name: 'universal-agent-runtime',
            version: '1.0.0',
            platform: `${process.platform}-${process.arch}`,
            state: 'installed' as const,
            binaryPath: managedPath,
            message: 'installed'
          }
        }))
      }
    })

    // No allowPathDiscovery flag: a stale PATH binary must not override the managed one.
    await service.ensureRunning({ kind: 'uar', mode: 'embedded' })

    expect(spawnMock).toHaveBeenCalledWith(managedPath, expect.any(Array), expect.any(Object))
    expect(discovery.discover).not.toHaveBeenCalled()
    await service.stop()
  })

  it('uses a detected PATH binary when allowPathDiscovery is opted in and no managed binary exists', async () => {
    const detectedPath = path.join(tempDir, 'path-uar', binaryName())
    fs.mkdirSync(path.dirname(detectedPath), { recursive: true })
    fs.writeFileSync(detectedPath, '')

    const child = createChildProcess()
    spawnMock.mockReturnValue(child)
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    const fakeSupervisor = createFakeSupervisor()
    const service = new UniversalAgentRuntimeService({
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService(detectedPath) as never,
      supervisor: fakeSupervisor.supervisor as never,
      managedBinaryService: {
        resolveInstalledBinary: vi.fn(async () => ({
          status: {
            name: 'universal-agent-runtime',
            version: '1.0.0',
            platform: `${process.platform}-${process.arch}`,
            state: 'missing' as const,
            binaryPath: path.join(tempDir, 'Data', 'managed-binaries', 'missing'),
            message: 'missing'
          }
        }))
      }
    })

    await service.ensureRunning({ kind: 'uar', mode: 'embedded', sidecar: { allowPathDiscovery: true } })

    expect(spawnMock).toHaveBeenCalledWith(detectedPath, expect.any(Array), expect.any(Object))
    await service.stop()
  })

  it('reports a missing managed binary instead of falling back to packaged resources', async () => {
    const service = new UniversalAgentRuntimeService({
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never,
      managedBinaryService: {
        resolveInstalledBinary: vi.fn(async () => ({
          status: {
            name: 'universal-agent-runtime',
            version: '1.0.0',
            platform: `${process.platform}-${process.arch}`,
            state: 'missing' as const,
            binaryPath: path.join(tempDir, 'Data', 'managed-binaries', 'missing'),
            message: 'missing'
          }
        }))
      }
    })

    await expect(service.ensureRunning({ kind: 'uar', mode: 'embedded' })).rejects.toThrow(
      'UAR embedded sidecar binary is missing'
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('refuses a managed binary verification failure instead of silently falling back', async () => {
    const managedPath = path.join(tempDir, 'Data', 'managed-binaries', 'bad-uar')

    const service = new UniversalAgentRuntimeService({
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never,
      managedBinaryService: {
        resolveInstalledBinary: vi.fn(async () => ({
          status: {
            name: 'universal-agent-runtime',
            version: '1.0.0',
            platform: `${process.platform}-${process.arch}`,
            state: 'verification-failed' as const,
            binaryPath: managedPath,
            message: 'Managed UAR SHA-256 mismatch.'
          }
        }))
      }
    })

    await expect(service.ensureRunning({ kind: 'uar', mode: 'embedded' })).rejects.toThrow(
      'Managed UAR SHA-256 mismatch.'
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('honors configured sidecar ports, data paths, log level, and native tool policy', async () => {
    const binaryPath = path.join(tempDir, 'custom-uar-bin')
    const dataDir = path.join(tempDir, 'custom-data')
    const rocksDbPath = path.join(dataDir, 'state')
    const uploadsPath = path.join(dataDir, 'files')
    fs.writeFileSync(binaryPath, '')

    const child = createChildProcess()
    spawnMock.mockReturnValue(child)
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    const fakeSupervisor = createFakeSupervisor()
    const service = new UniversalAgentRuntimeService({
      runtimeBinaryDiscoveryService: createRuntimeBinaryDiscoveryService() as never,
      supervisor: fakeSupervisor.supervisor as never
    })
    const endpoint = await service.ensureRunning({
      kind: 'uar',
      mode: 'embedded',
      sidecar: {
        binaryPath,
        port: 1906,
        grpcPort: 1907,
        dataDir,
        rocksDbPath,
        uploadsPath,
        logLevel: 'debug',
        nativeTools: {
          fileToolsEnabled: true,
          webFetchEnabled: false,
          terminalExecEnabled: false
        }
      }
    })

    expect(endpoint).toBe('http://127.0.0.1:1906')
    expect(spawnMock).toHaveBeenCalledWith(
      binaryPath,
      ['--config', path.join(dataDir, 'config.generated.yaml')],
      expect.objectContaining({
        cwd: dataDir,
        env: expect.objectContaining({
          RUST_LOG: 'debug',
          UAR_NATIVE_TOOLS__FILE_TOOLS_ENABLED: 'true',
          UAR_NATIVE_TOOLS__WEB_FETCH_ENABLED: 'false',
          UAR_NATIVE_TOOLS__TERMINAL_EXEC_ENABLED: 'false'
        })
      })
    )

    const config = fs.readFileSync(path.join(dataDir, 'config.generated.yaml'), 'utf8')
    expect(config).toContain('port: 1906')
    expect(config).toContain('grpc_port: 1907')
    expect(config).toContain(`database_url: "rocksdb://${rocksDbPath}"`)
    expect(config).toContain(`upload_dir: "${uploadsPath}"`)
    expect(config).toContain('file_tools_enabled: true')
    expect(config).toContain('web_fetch_enabled: false')
    expect(config).toContain('terminal_exec_enabled: false')

    await service.stop()
  })
})

interface FakeSupervisor {
  supervisor: Pick<SidecarProcessSupervisor, 'spawn' | 'stop'>
  spawn: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  lastSpec?: SupervisedSpawnSpec
  lastHandle?: SupervisedHandle
}

// A lightweight stand-in for SidecarProcessSupervisor: its spawn() actually
// invokes the spawn thunk (so the real spawnMock records options and
// waitForUarReady still drives the returned child), and stop() is observable.
function createFakeSupervisor(): FakeSupervisor {
  const fake: FakeSupervisor = {
    spawn: vi.fn(),
    stop: vi.fn(async () => undefined)
  } as FakeSupervisor

  fake.spawn.mockImplementation((spec: SupervisedSpawnSpec): SupervisedHandle => {
    const child = spec.spawn()
    const handle: SupervisedHandle = {
      id: `${spec.name}:default`,
      process: child,
      status: () => ({
        id: `${spec.name}:default`,
        name: spec.name,
        key: spec.key,
        pid: child.pid,
        binaryPath: spec.binaryPath,
        binaryVersion: spec.binaryVersion,
        cwd: spec.cwd,
        startedAt: Date.now(),
        state: 'running',
        restartCount: 0,
        recentStderr: []
      })
    }
    fake.lastSpec = spec
    fake.lastHandle = handle
    return handle
  })

  fake.supervisor = {
    spawn: fake.spawn as unknown as SidecarProcessSupervisor['spawn'],
    stop: fake.stop as unknown as SidecarProcessSupervisor['stop']
  }
  return fake
}

function binaryName(): string {
  return process.platform === 'win32' ? 'universal-agent-runtime.exe' : 'universal-agent-runtime'
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

function createRuntimeBinaryDiscoveryService(detectedPath?: string) {
  return {
    discover: vi.fn(async () => ({
      kind: 'uar',
      command: 'universal-agent-runtime',
      detectedPath,
      version: detectedPath ? 'universal-agent-runtime 1.0.0' : undefined,
      source: 'path' as const,
      available: Boolean(detectedPath),
      message: detectedPath
        ? `universal-agent-runtime was detected on PATH at ${detectedPath}.`
        : 'universal-agent-runtime was not found on PATH.'
    }))
  }
}
