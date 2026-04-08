import { afterEach, describe, expect, it, vi } from 'vitest'

/** Same as MCPService tests: BaseService → mcpApiService → MCPService pulls WindowService. */
vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => null)
  }
}))

import { BaseService } from '../../BaseService'
import { agentsTable, sessionsTable } from '../../database/schema'
import {
  clearAgentSessionUsageCacheForTests,
  getAgentSessionLastTotalTokens,
  setAgentSessionLastTotalTokens
} from '../agentContextStrategy/usageCache'
import { SessionService, sessionService } from '../SessionService'

const mockKnowledgeBase = {
  id: 'kb-1',
  name: 'Product Docs',
  model: {
    id: 'text-embedding-3-small',
    provider: 'openai',
    name: 'text-embedding-3-small',
    group: 'embedding'
  },
  items: [],
  created_at: 1,
  updated_at: 1,
  version: 1
}

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

  it('createSession inherits knowledge base fields from the agent snapshot', async () => {
    const now = '2026-04-07T00:00:00.000Z'
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))

    const insertedRows: any[] = []
    const transactionMock = vi.fn(async (callback) => {
      await callback({
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue({ rowsAffected: 0 })
          })
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn((row) => {
            insertedRows.push(row)
            return Promise.resolve()
          })
        })
      })
    })

    const selectMock = vi.fn(() => ({
      from: vi.fn((table) => ({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(
            table === agentsTable
              ? [
                  {
                    id: 'agent-1',
                    type: 'claude-code',
                    name: 'Agent',
                    description: 'Agent description',
                    accessible_paths: '[]',
                    instructions: 'System prompt',
                    model: 'openai:gpt-4.1',
                    knowledge_bases: JSON.stringify([mockKnowledgeBase]),
                    knowledgeRecognition: 'on',
                    created_at: now,
                    updated_at: now
                  }
                ]
              : [
                  {
                    id: 'session-created',
                    agent_id: 'agent-1',
                    agent_type: 'claude-code',
                    name: 'Agent',
                    description: 'Agent description',
                    accessible_paths: '[]',
                    instructions: 'System prompt',
                    model: 'openai:gpt-4.1',
                    knowledge_bases: JSON.stringify([mockKnowledgeBase]),
                    knowledgeRecognition: 'on',
                    created_at: now,
                    updated_at: now
                  }
                ]
          )
        })
      }))
    }))

    vi.spyOn(SessionService.prototype as any, 'validateAgentModels').mockResolvedValue(undefined)
    vi.spyOn(SessionService.prototype as any, 'listMcpTools').mockResolvedValue({ tools: [], legacyIdMap: new Map() })
    vi.spyOn(SessionService.prototype as any, 'buildKnowledgeBaseRuntimeConfigs').mockResolvedValue(undefined)
    vi.spyOn(BaseService.prototype, 'getDatabase').mockResolvedValue({
      select: selectMock,
      transaction: transactionMock
    } as never)

    const session = await sessionService.createSession('agent-1')

    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]).toEqual(
      expect.objectContaining({
        agent_id: 'agent-1',
        knowledge_bases: JSON.stringify([mockKnowledgeBase]),
        knowledgeRecognition: 'on'
      })
    )
    expect(session?.knowledge_bases).toEqual([mockKnowledgeBase])
    expect(session?.knowledgeRecognition).toBe('on')

    vi.useRealTimers()
  })

  it('updateSession persists knowledge base overrides and recognition mode', async () => {
    const setMock = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowsAffected: 1 })
    })
    const updateMock = vi.fn().mockReturnValue({ set: setMock })

    vi.spyOn(SessionService.prototype, 'getSession').mockResolvedValue({
      id: 'sess-1',
      agent_id: 'agent-1',
      agent_type: 'claude-code',
      name: 'Session',
      accessible_paths: [],
      model: 'openai:gpt-4.1'
    } as any)
    vi.spyOn(SessionService.prototype as any, 'validateAgentModels').mockResolvedValue(undefined)
    vi.spyOn(SessionService.prototype as any, 'buildKnowledgeBaseRuntimeConfigs').mockResolvedValue(undefined)
    vi.spyOn(BaseService.prototype, 'getDatabase').mockResolvedValue({ update: updateMock } as never)

    await sessionService.updateSession('agent-1', 'sess-1', {
      knowledge_bases: [mockKnowledgeBase],
      knowledgeRecognition: 'on'
    })

    expect(updateMock).toHaveBeenCalledWith(sessionsTable)
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledge_bases: JSON.stringify([mockKnowledgeBase]),
        knowledgeRecognition: 'on',
        updated_at: expect.any(String)
      })
    )
  })
})
