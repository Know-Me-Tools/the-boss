import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetModels, mockInitSkillsForAgent } = vi.hoisted(() => ({
  mockGetModels: vi.fn(),
  mockInitSkillsForAgent: vi.fn()
}))

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn()
}))

vi.mock('@main/utils', () => ({
  getDataPath: vi.fn(() => '/mock/data')
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

vi.mock('@main/apiServer/services/models', () => ({
  modelsService: {
    getModels: mockGetModels
  }
}))

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

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => null)
  }
}))

vi.mock('electron-window-state', () => ({
  default: vi.fn(function () {
    return {
      x: 0,
      y: 0,
      width: 1024,
      height: 768,
      manage: vi.fn()
    }
  })
}))

vi.mock('../../skills/SkillService', () => ({
  skillService: {
    initSkillsForAgent: mockInitSkillsForAgent
  }
}))

import { BaseService } from '../../BaseService'
import { AgentService } from '../AgentService'

function createSelectQuery(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows)
      }))
    }))
  }
}

describe('AgentService built-in agent lifecycle', () => {
  const service = AgentService.getInstance()
  let updateSet: ReturnType<typeof vi.fn>
  let updateWhere: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    updateWhere = vi.fn().mockResolvedValue(undefined)
    updateSet = vi.fn(() => ({ where: updateWhere }))
  })

  function createDatabaseWithExistingAgent(agent: Record<string, unknown>) {
    return {
      select: vi.fn(() => createSelectQuery([agent])),
      update: vi.fn(() => ({ set: updateSet }))
    }
  }

  it('skips recreating a built-in agent that was soft-deleted by the user', async () => {
    const database = {
      select: vi.fn(() =>
        createSelectQuery([{ id: 'cherry-assistant-default', deleted_at: '2026-04-15T00:00:00.000Z' }])
      )
    }

    vi.spyOn(BaseService.prototype, 'getDatabase').mockResolvedValue(database as never)

    const result = await service.initBuiltinAgent({
      id: 'cherry-assistant-default',
      builtinRole: 'assistant',
      provisionWorkspace: vi.fn()
    })

    expect(result).toEqual({ agentId: null, skippedReason: 'deleted' })
    expect(mockGetModels).not.toHaveBeenCalled()
  })

  it('renames an existing default CherryClaw agent that still has the old default display name', async () => {
    const database = createDatabaseWithExistingAgent({
      id: 'cherry-claw-default',
      name: 'Cherry Claw',
      description: 'Default autonomous CherryClaw agent',
      deleted_at: null
    })

    vi.spyOn(BaseService.prototype, 'getDatabase').mockResolvedValue(database as never)

    const result = await service.initDefaultCherryClawAgent()

    expect(result).toEqual({ agentId: 'cherry-claw-default' })
    expect(mockGetModels).not.toHaveBeenCalled()
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Boss Claw',
        description: 'Default autonomous Boss Claw agent',
        updated_at: expect.any(String)
      })
    )
  })

  it('preserves an existing default CherryClaw agent that has a customized display name', async () => {
    const database = createDatabaseWithExistingAgent({
      id: 'cherry-claw-default',
      name: 'Operations Copilot',
      description: 'Default autonomous CherryClaw agent',
      deleted_at: null
    })

    vi.spyOn(BaseService.prototype, 'getDatabase').mockResolvedValue(database as never)

    const result = await service.initDefaultCherryClawAgent()

    expect(result).toEqual({ agentId: 'cherry-claw-default' })
    expect(mockGetModels).not.toHaveBeenCalled()
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Default autonomous Boss Claw agent',
        updated_at: expect.any(String)
      })
    )
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'Boss Claw' }))
  })

  it('renames an existing Cherry Assistant default agent that still has the old default display name', async () => {
    const database = createDatabaseWithExistingAgent({
      id: 'cherry-assistant-default',
      name: 'Cherry Assistant',
      description: 'Built-in The Boss advisor',
      deleted_at: null
    })

    vi.spyOn(BaseService.prototype, 'getDatabase').mockResolvedValue(database as never)

    const result = await service.initBuiltinAgent({
      id: 'cherry-assistant-default',
      builtinRole: 'assistant',
      provisionWorkspace: vi.fn().mockResolvedValue({ name: 'Boss Assistant' })
    })

    expect(result).toEqual({ agentId: 'cherry-assistant-default' })
    expect(mockGetModels).not.toHaveBeenCalled()
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Boss Assistant',
        updated_at: expect.any(String)
      })
    )
  })

  it('soft-deletes built-in agents while preserving the row', async () => {
    const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: 1 })
    const txDelete = vi.fn(() => ({ where: deleteWhere }))
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const txUpdateSet = vi.fn(() => ({ where: updateWhere }))
    const txUpdate = vi.fn(() => ({ set: txUpdateSet }))
    const database = {
      select: vi.fn(() => createSelectQuery([{ id: 'cherry-claw-default', deleted_at: null }])),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
        callback({ delete: txDelete, update: txUpdate })
      ),
      delete: vi.fn(() => ({ where: deleteWhere }))
    }

    vi.spyOn(BaseService.prototype, 'getDatabase').mockResolvedValue(database as never)

    const deleted = await service.deleteAgent('cherry-claw-default')

    expect(deleted).toBe(true)
    expect(database.transaction).toHaveBeenCalledTimes(1)
    expect(txDelete).toHaveBeenCalledTimes(3)
    expect(txUpdate).toHaveBeenCalledTimes(2)
    expect(database.delete).not.toHaveBeenCalled()
    expect(txUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ agentId: null }))
    expect(txUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        deleted_at: expect.any(String),
        updated_at: expect.any(String)
      })
    )
  })
})
