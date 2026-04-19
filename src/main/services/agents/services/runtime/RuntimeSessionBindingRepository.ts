import { loggerService } from '@logger'
import type { AgentRuntimeKind, AgentRuntimeSessionBinding } from '@types'
import { and, eq } from 'drizzle-orm'

import { BaseService } from '../../BaseService'
import { type AgentRuntimeSessionBindingRow, agentRuntimeSessionBindingsTable } from '../../database/schema'

const logger = loggerService.withContext('RuntimeSessionBindingRepository')

export interface UpsertRuntimeSessionBindingInput {
  sessionId: string
  runtimeKind: AgentRuntimeKind
  runtimeSessionId: string
  agentId?: string
  metadata?: Record<string, unknown>
}

export class RuntimeSessionBindingRepository extends BaseService {
  private static instance: RuntimeSessionBindingRepository | null = null

  static getInstance(): RuntimeSessionBindingRepository {
    if (!RuntimeSessionBindingRepository.instance) {
      RuntimeSessionBindingRepository.instance = new RuntimeSessionBindingRepository()
    }
    return RuntimeSessionBindingRepository.instance
  }

  async getRuntimeSessionId(sessionId: string, runtimeKind: AgentRuntimeKind): Promise<string> {
    const binding = await this.getBinding(sessionId, runtimeKind)
    return binding?.runtime_session_id ?? ''
  }

  async getBinding(sessionId: string, runtimeKind: AgentRuntimeKind): Promise<AgentRuntimeSessionBinding | null> {
    const db = await this.getDatabase()
    const rows = await db
      .select()
      .from(agentRuntimeSessionBindingsTable)
      .where(
        and(
          eq(agentRuntimeSessionBindingsTable.session_id, sessionId),
          eq(agentRuntimeSessionBindingsTable.runtime_kind, runtimeKind)
        )
      )
      .limit(1)

    return rows[0] ? this.rowToBinding(rows[0]) : null
  }

  async upsertBinding(input: UpsertRuntimeSessionBindingInput): Promise<AgentRuntimeSessionBinding> {
    const db = await this.getDatabase()
    const now = Date.now()

    await db
      .insert(agentRuntimeSessionBindingsTable)
      .values({
        session_id: input.sessionId,
        agent_id: input.agentId,
        runtime_kind: input.runtimeKind,
        runtime_session_id: input.runtimeSessionId,
        metadata: input.metadata,
        created_at: now,
        updated_at: now
      })
      .onConflictDoUpdate({
        target: [agentRuntimeSessionBindingsTable.session_id, agentRuntimeSessionBindingsTable.runtime_kind],
        set: {
          agent_id: input.agentId,
          runtime_session_id: input.runtimeSessionId,
          metadata: input.metadata,
          updated_at: now
        }
      })

    const binding = await this.getBinding(input.sessionId, input.runtimeKind)
    if (!binding) {
      throw new Error(`Failed to upsert runtime session binding for ${input.sessionId}/${input.runtimeKind}`)
    }

    logger.debug('Runtime session binding upserted', {
      sessionId: input.sessionId,
      runtimeKind: input.runtimeKind
    })
    return binding
  }

  private rowToBinding(row: AgentRuntimeSessionBindingRow): AgentRuntimeSessionBinding {
    return {
      session_id: row.session_id,
      agent_id: row.agent_id ?? undefined,
      runtime_kind: row.runtime_kind,
      runtime_session_id: row.runtime_session_id,
      metadata: row.metadata ?? undefined,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString()
    }
  }
}

export const runtimeSessionBindingRepository = RuntimeSessionBindingRepository.getInstance()
