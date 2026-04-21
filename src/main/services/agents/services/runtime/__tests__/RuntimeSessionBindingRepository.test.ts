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
import { RuntimeSessionBindingRepository } from '../RuntimeSessionBindingRepository'

describe('RuntimeSessionBindingRepository', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('reads and upserts runtime session ids by app session and runtime kind', async () => {
    const selectedRows = [
      {
        session_id: 'session-1',
        runtime_kind: 'codex',
        agent_id: 'agent-1',
        runtime_session_id: 'thread-codex',
        metadata: null,
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

    const repository = RuntimeSessionBindingRepository.getInstance()

    await expect(repository.getRuntimeSessionId('session-1', 'codex')).resolves.toBe('thread-codex')
    await expect(
      repository.upsertBinding({
        sessionId: 'session-1',
        agentId: 'agent-1',
        runtimeKind: 'codex',
        runtimeSessionId: 'thread-codex'
      })
    ).resolves.toMatchObject({
      session_id: 'session-1',
      runtime_kind: 'codex',
      runtime_session_id: 'thread-codex'
    })

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 'session-1',
        runtime_kind: 'codex',
        runtime_session_id: 'thread-codex'
      })
    )
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1)
  })
})
