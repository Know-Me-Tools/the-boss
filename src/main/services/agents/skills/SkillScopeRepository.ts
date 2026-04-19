import { loggerService } from '@logger'
import type { SkillConfigOverride, SkillScopeConfigRow, SkillScopeRef } from '@types'
import { and, eq } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { type SkillScopeRow, skillScopesTable } from '../database/schema'

const logger = loggerService.withContext('SkillScopeRepository')

export class SkillScopeRepository extends BaseService {
  private static instance: SkillScopeRepository | null = null

  static getInstance(): SkillScopeRepository {
    if (!SkillScopeRepository.instance) {
      SkillScopeRepository.instance = new SkillScopeRepository()
    }
    return SkillScopeRepository.instance
  }

  async get(scope: SkillScopeRef): Promise<SkillScopeConfigRow | null> {
    const db = await this.getDatabase()
    const rows = await db
      .select()
      .from(skillScopesTable)
      .where(and(eq(skillScopesTable.scope_type, scope.type), eq(skillScopesTable.scope_id, scope.id)))
      .limit(1)

    return rows[0] ? this.rowToConfig(rows[0]) : null
  }

  async upsert(scope: SkillScopeRef, config: SkillConfigOverride | null): Promise<SkillScopeConfigRow> {
    const db = await this.getDatabase()
    const now = Date.now()

    await db
      .insert(skillScopesTable)
      .values({
        scope_type: scope.type,
        scope_id: scope.id,
        config,
        created_at: now,
        updated_at: now
      })
      .onConflictDoUpdate({
        target: [skillScopesTable.scope_type, skillScopesTable.scope_id],
        set: { config, updated_at: now }
      })

    const updated = await this.get(scope)
    if (!updated) {
      throw new Error(`Failed to upsert skill scope ${scope.type}:${scope.id}`)
    }

    logger.info('Skill scope upserted', { scopeType: scope.type, scopeId: scope.id })
    return updated
  }

  private rowToConfig(row: SkillScopeRow): SkillScopeConfigRow {
    return {
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      config: row.config ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
