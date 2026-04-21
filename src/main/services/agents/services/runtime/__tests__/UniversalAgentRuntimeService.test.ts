import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UniversalAgentRuntimeService } from '../UniversalAgentRuntimeService'

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
    const service = new UniversalAgentRuntimeService()

    await expect(service.ensureRunning({ kind: 'uar', mode: 'embedded' })).rejects.toThrow(
      'UAR embedded sidecar binary is missing'
    )
  })

  it('generates config, starts the sidecar, waits for health, and stops it', async () => {
    const binaryPath = path.join(tempDir, 'resources', 'binaries', `${process.platform}-${process.arch}`, binaryName())
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true })
    fs.writeFileSync(binaryPath, '')

    const child = createChildProcess()
    spawnMock.mockReturnValue(child)
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    const service = new UniversalAgentRuntimeService()
    const endpoint = await service.ensureRunning(
      { kind: 'uar', mode: 'embedded' },
      {
        providerId: 'openai',
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com',
        modelId: 'gpt-5.2'
      }
    )

    expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(spawnMock).toHaveBeenCalledWith(
      binaryPath,
      ['--config', expect.stringContaining('config.generated.yaml')],
      expect.objectContaining({
        cwd: path.join(tempDir, 'Data', 'uar'),
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

    expect(child.kill).toHaveBeenCalled()
  })

  it('prefers a verified managed app-data binary over the bundled fallback', async () => {
    const bundledPath = path.join(tempDir, 'resources', 'binaries', `${process.platform}-${process.arch}`, binaryName())
    const managedPath = path.join(
      tempDir,
      'Data',
      'managed-binaries',
      'uar',
      '1.0.0',
      `${process.platform}-${process.arch}`,
      binaryName()
    )
    fs.mkdirSync(path.dirname(bundledPath), { recursive: true })
    fs.mkdirSync(path.dirname(managedPath), { recursive: true })
    fs.writeFileSync(bundledPath, '')
    fs.writeFileSync(managedPath, '')

    const child = createChildProcess()
    spawnMock.mockReturnValue(child)
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    const service = new UniversalAgentRuntimeService({
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

  it('falls back to the bundled binary when no managed binary is installed', async () => {
    const bundledPath = path.join(tempDir, 'resources', 'binaries', `${process.platform}-${process.arch}`, binaryName())
    fs.mkdirSync(path.dirname(bundledPath), { recursive: true })
    fs.writeFileSync(bundledPath, '')

    const child = createChildProcess()
    spawnMock.mockReturnValue(child)
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    const service = new UniversalAgentRuntimeService({
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

    await service.ensureRunning({ kind: 'uar', mode: 'embedded' })

    expect(spawnMock).toHaveBeenCalledWith(bundledPath, expect.any(Array), expect.any(Object))
    await service.stop()
  })

  it('refuses a managed binary verification failure instead of silently falling back', async () => {
    const bundledPath = path.join(tempDir, 'resources', 'binaries', `${process.platform}-${process.arch}`, binaryName())
    const managedPath = path.join(tempDir, 'Data', 'managed-binaries', 'bad-uar')
    fs.mkdirSync(path.dirname(bundledPath), { recursive: true })
    fs.writeFileSync(bundledPath, '')

    const service = new UniversalAgentRuntimeService({
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

    const service = new UniversalAgentRuntimeService()
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
