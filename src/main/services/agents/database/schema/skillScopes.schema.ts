/**
 * Drizzle ORM schema for skill scope configuration.
 *
 * A scope stores skill-selection configuration for a global default,
 * assistant, topic, agent, or session. Agent workspace enablement remains in
 * agent_skills because it has filesystem symlink side effects.
 */

import type { SkillConfigOverride } from '@types'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

type SkillScopeType = 'global' | 'assistant' | 'topic' | 'agent' | 'session'

export const skillScopesTable = sqliteTable(
  'skill_scopes',
  {
    scope_type: text('scope_type').$type<SkillScopeType>().notNull(),
    scope_id: text('scope_id').notNull(),
    config: text('config', { mode: 'json' }).$type<SkillConfigOverride | null>(),
    created_at: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    updated_at: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now())
      .$onUpdateFn(() => Date.now())
  },
  (t) => [
    primaryKey({ columns: [t.scope_type, t.scope_id] }),
    index('idx_skill_scopes_scope_type').on(t.scope_type),
    index('idx_skill_scopes_scope_id').on(t.scope_id)
  ]
)

export type SkillScopeRow = typeof skillScopesTable.$inferSelect
export type InsertSkillScopeRow = typeof skillScopesTable.$inferInsert
