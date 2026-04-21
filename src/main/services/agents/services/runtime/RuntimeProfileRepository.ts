import { loggerService } from '@logger'
import type { AgentRuntimeConfig, AgentRuntimeKind, AgentRuntimeProfile, AgentRuntimeSettings } from '@types'
import { AgentRuntimeConfigSchema } from '@types'
import { eq } from 'drizzle-orm'

import { BaseService } from '../../BaseService'
import {
  type AgentRuntimeProfileRow,
  agentRuntimeProfilesTable,
  type AgentRuntimeSettingsRow,
  agentRuntimeSettingsTable
} from '../../database/schema'

const logger = loggerService.withContext('RuntimeProfileRepository')

export type UpsertRuntimeProfileInput = {
  id: string
  name: string
  kind: AgentRuntimeKind
  config: Partial<AgentRuntimeConfig>
  isDefault?: boolean
}

export type UpsertRuntimeSettingsInput = {
  kind: AgentRuntimeKind
  enabled?: boolean
  config: Partial<AgentRuntimeConfig>
}

export class RuntimeProfileRepository extends BaseService {
  private static instance: RuntimeProfileRepository | null = null

  static getInstance(): RuntimeProfileRepository {
    if (!RuntimeProfileRepository.instance) {
      RuntimeProfileRepository.instance = new RuntimeProfileRepository()
    }
    return RuntimeProfileRepository.instance
  }

  async listProfiles(kind?: AgentRuntimeKind): Promise<AgentRuntimeProfile[]> {
    const db = await this.getDatabase()
    const query = db.select().from(agentRuntimeProfilesTable)
    const rows = kind ? await query.where(eq(agentRuntimeProfilesTable.runtime_kind, kind)) : await query
    return rows.map((row) => this.rowToProfile(row))
  }

  async getProfile(id: string): Promise<AgentRuntimeProfile | null> {
    const db = await this.getDatabase()
    const rows = await db.select().from(agentRuntimeProfilesTable).where(eq(agentRuntimeProfilesTable.id, id)).limit(1)
    return rows[0] ? this.rowToProfile(rows[0]) : null
  }

  async getSettings(kind: AgentRuntimeKind): Promise<AgentRuntimeSettings | null> {
    const db = await this.getDatabase()
    const rows = await db
      .select()
      .from(agentRuntimeSettingsTable)
      .where(eq(agentRuntimeSettingsTable.runtime_kind, kind))
      .limit(1)
    return rows[0] ? this.rowToSettings(rows[0]) : null
  }

  async upsertProfile(input: UpsertRuntimeProfileInput): Promise<AgentRuntimeProfile> {
    const db = await this.getDatabase()
    const now = Date.now()
    const config = AgentRuntimeConfigSchema.parse({
      ...input.config,
      kind: input.kind
    })

    await db
      .insert(agentRuntimeProfilesTable)
      .values({
        id: input.id,
        name: input.name,
        runtime_kind: input.kind,
        config,
        is_default: input.isDefault ?? false,
        created_at: now,
        updated_at: now
      })
      .onConflictDoUpdate({
        target: agentRuntimeProfilesTable.id,
        set: {
          name: input.name,
          runtime_kind: input.kind,
          config,
          is_default: input.isDefault ?? false,
          updated_at: now
        }
      })

    const profile = await this.getProfile(input.id)
    if (!profile) {
      throw new Error(`Failed to upsert runtime profile ${input.id}`)
    }

    logger.info('Runtime profile upserted', { id: input.id, runtimeKind: input.kind })
    return profile
  }

  async upsertSettings(input: UpsertRuntimeSettingsInput): Promise<AgentRuntimeSettings> {
    const db = await this.getDatabase()
    const now = Date.now()
    const config = AgentRuntimeConfigSchema.parse({
      ...input.config,
      kind: input.kind
    })

    await db
      .insert(agentRuntimeSettingsTable)
      .values({
        runtime_kind: input.kind,
        enabled: input.enabled ?? true,
        config,
        updated_at: now
      })
      .onConflictDoUpdate({
        target: agentRuntimeSettingsTable.runtime_kind,
        set: {
          enabled: input.enabled ?? true,
          config,
          updated_at: now
        }
      })

    return {
      kind: input.kind,
      enabled: input.enabled ?? true,
      config,
      updated_at: new Date(now).toISOString()
    }
  }

  private rowToProfile(row: AgentRuntimeProfileRow): AgentRuntimeProfile {
    return {
      id: row.id,
      name: row.name,
      kind: row.runtime_kind,
      config: AgentRuntimeConfigSchema.parse(row.config),
      isDefault: row.is_default,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString()
    }
  }

  private rowToSettings(row: AgentRuntimeSettingsRow): AgentRuntimeSettings {
    return {
      kind: row.runtime_kind,
      enabled: row.enabled,
      config: AgentRuntimeConfigSchema.parse(row.config),
      updated_at: new Date(row.updated_at).toISOString()
    }
  }
}
