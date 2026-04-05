import { EventEmitter } from 'node:events'
import path from 'node:path'

import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@main/services/ConfigManager', () => ({
  ConfigKeys: {
    GitBashPath: 'gitBashPath'
  },
  configManager: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock('@shared/config/constant', async () => {
  const actual = await vi.importActual<object>('@shared/config/constant')
  return {
    ...actual,
    HOME_CHERRY_DIR: '.the-boss'
  }
})

vi.mock('../index', () => ({
  getResourcePath: vi.fn(() => '/app/resources')
}))

vi.mock('../shell-env', () => ({
  default: vi.fn(),
  refreshShellEnv: vi.fn()
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn()
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn()
  },
  existsSync: vi.fn()
}))

import { getBinaryPath, isBinaryExists, runInstallScript } from '../process'

function createMockChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
  }

  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()

  return child
}

describe('process install helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the branded app home dir to install scripts', async () => {
    const child = createMockChildProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    const installPromise = runInstallScript('install-uv.js', { OPENCLAW_USE_MIRROR: '1' })
    child.emit('close', 0)

    await expect(installPromise).resolves.toBeUndefined()
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ['/app/resources/scripts/install-uv.js'],
      expect.objectContaining({
        env: expect.objectContaining({
          ELECTRON_RUN_AS_NODE: '1',
          APP_HOME_DIR: '.the-boss',
          OPENCLAW_USE_MIRROR: '1'
        })
      })
    )
  })

  it('prefers the current branded binary location and falls back to the legacy one', async () => {
    const homeDir = os.homedir()
    const currentPath = path.join(homeDir, '.the-boss', 'bin', 'uv')
    const legacyPath = path.join(homeDir, '.theboss', 'bin', 'uv')

    vi.mocked(fs.existsSync).mockImplementation((filePath) => filePath === legacyPath)

    await expect(getBinaryPath('uv')).resolves.toBe(legacyPath)
    await expect(isBinaryExists('uv')).resolves.toBe(true)

    vi.mocked(fs.existsSync).mockImplementation((filePath) => filePath === currentPath || filePath === legacyPath)

    await expect(getBinaryPath('uv')).resolves.toBe(currentPath)
  })
})
