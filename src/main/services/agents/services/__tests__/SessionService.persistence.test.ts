import { afterEach, describe, expect, it, vi } from 'vitest'

/** Same as MCPService tests: BaseService → mcpApiService → MCPService pulls WindowService. */
vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => null)
  }
}))

import { BaseService } from '../../BaseService'
import { sessionsTable } from '../../database/schema'
import {
  clearAgentSessionUsageCacheForTests,
  getAgentSessionLastTotalTokens,
  setAgentSessionLastTotalTokens
} from '../agentContextStrategy/usageCache'
import { sessionService } from '../SessionService'

describe('SessionService last_total_tokens persistence', () => {
  afterEach(() => {
    clearAgentSessionUsageCacheForTests()
    vi.restoreAllMocks()
  })

  it('persistSessionLastTotalTokens updates sessions row with floored tokens', async () => {
    const whereMock = vi.fn().mockResolvedValue({ rowsAffected: 1 })
    const setMock = vi.fn().mockReturnValue({ where: whereMock })
    const updateMock = vi.fn().mockReturnValue({ set: setMock })
    vi.spyOn(BaseService.prototype, 'getDatabase').mockResolvedValue({ update: updateMock } as never)

    await sessionService.persistSessionLastTotalTokens('agent-1', 'sess-1', 12345.7)

    expect(updateMock).toHaveBeenCalledWith(sessionsTable)
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        last_total_tokens: 12345,
        updated_at: expect.any(String)
      })
    )
    expect(whereMock).toHaveBeenCalled()
  })

  it('persistSessionLastTotalTokens skips invalid token values', async () => {
    const updateMock = vi.fn()
    vi.spyOn(BaseService.prototype, 'getDatabase').mockResolvedValue({ update: updateMock } as never)

    await sessionService.persistSessionLastTotalTokens('a', 's', -1)
    await sessionService.persistSessionLastTotalTokens('a', 's', Number.NaN)

    expect(updateMock).not.toHaveBeenCalled()
  })

  it('ensureLastTotalTokensInMemory loads from DB when cache is empty', async () => {
    const limitMock = vi.fn().mockResolvedValue([{ id: 'sess-x', last_total_tokens: 88 }])
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock })
    const fromMock = vi.fn().mockReturnValue({ where: whereMock })
    const selectMock = vi.fn().mockReturnValue({ from: fromMock })
    vi.spyOn(BaseService.prototype, 'getDatabase').mockResolvedValue({ select: selectMock } as never)

    await sessionService.ensureLastTotalTokensInMemory('agent-1', 'sess-x')

    expect(getAgentSessionLastTotalTokens('sess-x')).toBe(88)
  })

  it('ensureLastTotalTokensInMemory does not query DB when cache already has a value', async () => {
    setAgentSessionLastTotalTokens('sess-y', 10)
    const selectMock = vi.fn()
    vi.spyOn(BaseService.prototype, 'getDatabase').mockResolvedValue({ select: selectMock } as never)

    await sessionService.ensureLastTotalTokensInMemory('agent-1', 'sess-y')

    expect(selectMock).not.toHaveBeenCalled()
  })
})
