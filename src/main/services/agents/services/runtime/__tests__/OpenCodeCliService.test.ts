import { type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as fsAsync from 'node:fs/promises'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildOpenCodeGlobalConfigFromCherryProviders, OpenCodeCliService } from '../OpenCodeCliService'

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
      homedir: () => tempDir
    })

    expect(service.resolveBinary()).toEqual(
      expect.objectContaining({
        path: binaryPath,
        source: 'development',
        state: 'ready'
      })
    )
  })

  it('resolves a packaged resource binary path', async () => {
    const appPath = path.join(tempDir, 'app')
    const binaryPath = path.join(appPath, 'resources', 'opencode', platformResourceDir(), binaryName())
    await writeExecutable(binaryPath)
    const service = new OpenCodeCliService({
      appPath: () => appPath,
      developmentBinaryPath: () => undefined,
      homedir: () => tempDir
    })

    expect(service.resolveBinary()).toEqual(
      expect.objectContaining({
        path: binaryPath,
        source: 'packaged',
        state: 'ready'
      })
    )
  })

  it('remaps packaged ASAR resource paths to app.asar.unpacked', async () => {
    ;(app as any).isPackaged = true
    const asarAppPath = path.join(tempDir, 'TheBoss.app', 'Contents', 'Resources', 'app.asar')
    const unpackedBinaryPath = path.join(
      tempDir,
      'TheBoss.app',
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'resources',
      'opencode',
      platformResourceDir(),
      binaryName()
    )
    await writeExecutable(unpackedBinaryPath)
    const service = new OpenCodeCliService({
      appPath: () => asarAppPath,
      developmentBinaryPath: () => undefined,
      homedir: () => tempDir
    })

    expect(service.resolveBinary()).toEqual(
      expect.objectContaining({
        path: unpackedBinaryPath,
        source: 'packaged',
        state: 'ready'
      })
    )
  })

  it('returns a useful health error when the embedded executable is missing', () => {
    const service = new OpenCodeCliService({
      appPath: () => tempDir,
      developmentBinaryPath: () => undefined,
      homedir: () => tempDir
    })

    expect(service.resolveBinary()).toEqual(
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
    const service = new OpenCodeCliService({
      developmentBinaryPath: () => binaryPath,
      spawnProcess,
      loadSdk: async () => ({ createOpencodeClient }) as any,
      homedir: () => tempDir,
      getAvailableProviders: async () => []
    })

    const first = await service.listModels({ kind: 'opencode', mode: 'managed' } as any, tempDir)
    const second = await service.listModels({ kind: 'opencode', mode: 'managed' } as any, tempDir)

    expect(spawnProcess).toHaveBeenCalledTimes(1)
    expect(spawnProcess).toHaveBeenCalledWith(
      binaryPath,
      ['serve', '--hostname', '127.0.0.1', '--port', '0'],
      expect.objectContaining({
        cwd: tempDir,
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

    await service.dispose()
    expect(child.kill).toHaveBeenCalled()
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

function platformResourceDir(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'darwin') return `darwin-${arch}`
  if (process.platform === 'linux') return `linux-${arch}`
  return `win32-${arch}`
}

function binaryName(): string {
  return process.platform === 'win32' ? 'opencode.exe' : 'opencode'
}
