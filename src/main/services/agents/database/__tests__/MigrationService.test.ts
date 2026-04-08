import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils', () => ({
  getResourcePath: () => '/mock/resources'
}))

import { MigrationService } from '../MigrationService'

describe('MigrationService critical schema repair', () => {
  it('adds missing knowledge columns when migration history is out of sync with schema', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql === 'PRAGMA table_info(`agents`)') {
        return {
          rows: [{ name: 'id' }, { name: 'type' }, { name: 'name' }]
        }
      }

      if (sql === 'PRAGMA table_info(`sessions`)') {
        return {
          rows: [{ name: 'id' }, { name: 'agent_id' }]
        }
      }

      return { rows: [] }
    })

    const client = {
      execute
    }

    const service = new MigrationService({} as never, client as never)

    await (service as any).ensureCriticalSchemaCompatibility()

    expect(execute).toHaveBeenNthCalledWith(1, 'PRAGMA table_info(`agents`)')
    expect(execute).toHaveBeenNthCalledWith(2, 'ALTER TABLE `agents` ADD `knowledge_bases` text;')
    expect(execute).toHaveBeenNthCalledWith(3, 'ALTER TABLE `agents` ADD `knowledgeRecognition` text;')
    expect(execute).toHaveBeenNthCalledWith(4, 'ALTER TABLE `agents` ADD `knowledge_base_configs` text;')
    expect(execute).toHaveBeenNthCalledWith(5, 'PRAGMA table_info(`sessions`)')
    expect(execute).toHaveBeenNthCalledWith(6, 'ALTER TABLE `sessions` ADD `knowledge_bases` text;')
    expect(execute).toHaveBeenNthCalledWith(7, 'ALTER TABLE `sessions` ADD `knowledgeRecognition` text;')
    expect(execute).toHaveBeenNthCalledWith(8, 'ALTER TABLE `sessions` ADD `knowledge_base_configs` text;')
  })

  it('does nothing when the required columns already exist', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        { name: 'id' },
        { name: 'knowledge_bases' },
        { name: 'knowledgeRecognition' },
        { name: 'knowledge_base_configs' }
      ]
    })

    const client = {
      execute
    }

    const service = new MigrationService({} as never, client as never)

    await (service as any).ensureCriticalSchemaCompatibility()

    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenNthCalledWith(1, 'PRAGMA table_info(`agents`)')
    expect(execute).toHaveBeenNthCalledWith(2, 'PRAGMA table_info(`sessions`)')
  })
})
