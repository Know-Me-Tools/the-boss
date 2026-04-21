import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(function MockStore() {
    return {
      get: vi.fn((_: string, defaultValue?: unknown) => defaultValue),
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      has: vi.fn(() => false),
      store: {}
    }
  })
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    getAppPath: vi.fn(() => '/app'),
    getLocale: vi.fn(() => 'en-US')
  },
  BrowserWindow: Object.assign(vi.fn(), {
    getAllWindows: vi.fn(() => [])
  }),
  dialog: {},
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn()
  },
  nativeTheme: {
    on: vi.fn(),
    themeSource: 'system',
    shouldUseDarkColors: false
  },
  screen: {},
  session: {},
  shell: {}
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: true,
    macOS: false,
    windows: false,
    linux: true
  }
}))

vi.mock('electron-window-state', () => ({
  default: vi.fn(() => ({
    x: 0,
    y: 0,
    width: 1024,
    height: 768,
    manage: vi.fn()
  }))
}))

import { BaseService } from '../../../BaseService'
import { RuntimeProfileRepository } from '../RuntimeProfileRepository'

describe('RuntimeProfileRepository', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('upserts runtime profiles with normalized runtime config', async () => {
    const selectedRows = [
      {
        id: 'codex-default',
        name: 'Codex Default',
        runtime_kind: 'codex',
        config: { kind: 'codex', mode: 'managed' },
        is_default: true,
        created_at: 1,
        updated_at: 2
      }
    ]
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
    const values = vi.fn(() => ({ onConflictDoUpdate }))
    const limit = vi.fn().mockResolvedValue(selectedRows)
    const where = vi.fn(() => ({ limit }))
    const from = vi.fn(() => ({ where }))
    const database = {
      insert: vi.fn(() => ({ values })),
      select: vi.fn(() => ({ from }))
    }
    vi.spyOn(BaseService.prototype, 'getDatabase').mockResolvedValue(database as never)

    const repository = RuntimeProfileRepository.getInstance()
    const profile = await repository.upsertProfile({
      id: 'codex-default',
      name: 'Codex Default',
      kind: 'codex',
      config: { kind: 'codex' },
      isDefault: true
    })

    expect(database.insert).toHaveBeenCalledTimes(1)
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'codex-default',
        runtime_kind: 'codex',
        config: { kind: 'codex', mode: 'managed' },
        is_default: true
      })
    )
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1)
    expect(profile).toMatchObject({
      id: 'codex-default',
      kind: 'codex',
      config: { kind: 'codex', mode: 'managed' },
      isDefault: true
    })
  })
})
