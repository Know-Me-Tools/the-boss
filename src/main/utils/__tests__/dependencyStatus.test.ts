import fs from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn()
  }
}))

vi.mock('node:os', () => ({
  default: {
    homedir: () => '/home/testuser'
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@shared/config/constant', () => ({
  HOME_CHERRY_DIR: '.the-boss'
}))

vi.mock('../process', () => ({
  getBinaryName: vi.fn(async (name: string) => name),
  findExecutableInEnv: vi.fn(async () => null)
}))

vi.mock('..', () => ({
  getResourcePath: () => '/app/resources',
  toAsarUnpackedPath: (filePath: string) => filePath
}))

import { getDependencyStatus, getDependencyStatuses } from '../dependencyStatus'
import { findExecutableInEnv } from '../process'

const mockFs = vi.mocked(fs)
const mockFindExecutableInEnv = vi.mocked(findExecutableInEnv)

describe('dependency status resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.existsSync.mockReturnValue(false)
  })

  it('resolves uv from the environment when present', async () => {
    mockFindExecutableInEnv.mockImplementation(async (name: string) => (name === 'uv' ? '/usr/local/bin/uv' : null))

    const status = await getDependencyStatus('uv')

    expect(status).toEqual({
      name: 'uv',
      available: true,
      source: 'environment',
      resolvedPath: '/usr/local/bin/uv',
      bundledPath: '/home/testuser/.the-boss/bin/uv',
      environmentPath: '/usr/local/bin/uv',
      installSupported: true
    })
  })

  it('resolves bun from the managed path when environment lookup misses', async () => {
    mockFs.existsSync.mockImplementation((filePath) => String(filePath) === '/home/testuser/.the-boss/bin/bun')

    const status = await getDependencyStatus('bun')

    expect(status).toEqual({
      name: 'bun',
      available: true,
      source: 'bundled',
      resolvedPath: '/home/testuser/.the-boss/bin/bun',
      bundledPath: '/home/testuser/.the-boss/bin/bun',
      environmentPath: null,
      installSupported: true
    })
  })

  it('resolves rtk from the environment and marks install as unsupported', async () => {
    mockFindExecutableInEnv.mockImplementation(async (name: string) =>
      name === 'rtk' ? '/opt/homebrew/bin/rtk' : null
    )

    const status = await getDependencyStatus('rtk')

    expect(status.name).toBe('rtk')
    expect(status.available).toBe(true)
    expect(status.source).toBe('environment')
    expect(status.resolvedPath).toBe('/opt/homebrew/bin/rtk')
    expect(status.environmentPath).toBe('/opt/homebrew/bin/rtk')
    expect(status.installSupported).toBe(false)
  })

  it('returns missing when neither environment nor managed paths exist', async () => {
    const status = await getDependencyStatus('uv')

    expect(status).toEqual({
      name: 'uv',
      available: false,
      source: 'missing',
      resolvedPath: null,
      bundledPath: '/home/testuser/.the-boss/bin/uv',
      environmentPath: null,
      installSupported: true
    })
  })

  it('returns multiple dependency statuses in request order', async () => {
    mockFindExecutableInEnv.mockImplementation(async (name: string) => (name === 'uv' ? '/usr/local/bin/uv' : null))
    mockFs.existsSync.mockImplementation((filePath) => String(filePath) === '/home/testuser/.the-boss/bin/bun')

    const statuses = await getDependencyStatuses(['uv', 'bun'])

    expect(statuses.map((status) => status.name)).toEqual(['uv', 'bun'])
    expect(statuses.map((status) => status.source)).toEqual(['environment', 'bundled'])
  })
})
