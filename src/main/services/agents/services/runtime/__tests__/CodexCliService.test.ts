import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CodexCliService } from '../CodexCliService'

vi.mock('@main/utils', () => ({
  toAsarUnpackedPath: (filePath: string) => filePath.replace('/app.asar/', '/app.asar.unpacked/')
}))

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

  it('resolves an explicit configured Codex executable first', () => {
    const binaryPath = path.join('/tmp/codex-configured', process.platform === 'win32' ? 'codex.exe' : 'codex')
    existingFiles.add(binaryPath)

    const service = new CodexCliService({
      appPath: () => '/tmp/missing-app',
      developmentBinaryPath: () => undefined
    })

    expect(
      service.resolveBinary({
        kind: 'codex',
        mode: 'managed',
        sidecar: {
          binaryPath
        }
      })
    ).toEqual(
      expect.objectContaining({
        path: binaryPath,
        source: 'configured',
        state: 'ready'
      })
    )
  })

  it('resolves packaged Codex binaries from app.asar.unpacked paths', () => {
    const appPath = '/tmp/the-boss/app.asar'
    const platform = currentCodexPlatform()
    const binaryPath = path.join(
      '/tmp/the-boss',
      'app.asar.unpacked',
      'node_modules',
      ...platform.packageName.split('/'),
      'vendor',
      platform.triple,
      'codex',
      platform.binaryName
    )
    existingFiles.add(binaryPath)

    const service = new CodexCliService({
      appPath: () => appPath,
      developmentBinaryPath: () => undefined
    })

    expect(service.resolveBinary({ kind: 'codex', mode: 'managed' })).toEqual(
      expect.objectContaining({
        path: binaryPath,
        source: 'packaged',
        state: 'ready'
      })
    )
  })

  it('returns a clear missing-binary status when no executable can be found', () => {
    const service = new CodexCliService({
      appPath: () => '/tmp/missing-app',
      developmentBinaryPath: () => undefined
    })

    expect(service.resolveBinary({ kind: 'codex', mode: 'managed' })).toEqual(
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
      appPath: () => '/tmp/missing-app',
      developmentBinaryPath: () => binaryPath,
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
      appPath: () => '/tmp/missing-app',
      developmentBinaryPath: () => binaryPath,
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

function currentCodexPlatform() {
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return { triple: 'aarch64-apple-darwin', packageName: '@openai/codex-darwin-arm64', binaryName }
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return { triple: 'x86_64-apple-darwin', packageName: '@openai/codex-darwin-x64', binaryName }
  }
  if (process.platform === 'linux' && process.arch === 'arm64') {
    return { triple: 'aarch64-unknown-linux-musl', packageName: '@openai/codex-linux-arm64', binaryName }
  }
  if ((process.platform === 'linux' || process.platform === 'android') && process.arch === 'x64') {
    return { triple: 'x86_64-unknown-linux-musl', packageName: '@openai/codex-linux-x64', binaryName }
  }
  if (process.platform === 'win32' && process.arch === 'arm64') {
    return { triple: 'aarch64-pc-windows-msvc', packageName: '@openai/codex-win32-arm64', binaryName }
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return { triple: 'x86_64-pc-windows-msvc', packageName: '@openai/codex-win32-x64', binaryName }
  }
  throw new Error(`Unsupported test platform: ${process.platform}/${process.arch}`)
}
