/**
 * Drizzle ORM schema for runtime-agnostic agent runtime configuration.
 */

import type { AgentRuntimeConfig, AgentRuntimeKind } from '@types'
import { foreignKey, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agentsTable } from './agents.schema'
import { sessionsTable } from './sessions.schema'
import { skillsTable } from './skills.schema'

export type RuntimeSkillSyncStatus = 'pending' | 'synced' | 'error'

export const agentRuntimeProfilesTable = sqliteTable(
  'agent_runtime_profiles',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    runtime_kind: text('runtime_kind').$type<AgentRuntimeKind>().notNull(),
    config: text('config', { mode: 'json' }).$type<AgentRuntimeConfig>().notNull(),
    is_default: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    created_at: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    updated_at: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now())
      .$onUpdateFn(() => Date.now())
  },
  (t) => [
    index('idx_agent_runtime_profiles_kind').on(t.runtime_kind),
    index('idx_agent_runtime_profiles_default').on(t.runtime_kind, t.is_default)
  ]
)

export const agentRuntimeSettingsTable = sqliteTable(
  'agent_runtime_settings',
  {
    runtime_kind: text('runtime_kind').$type<AgentRuntimeKind>().primaryKey(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    config: text('config', { mode: 'json' }).$type<AgentRuntimeConfig>().notNull(),
    updated_at: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now())
      .$onUpdateFn(() => Date.now())
  },
  (t) => [index('idx_agent_runtime_settings_enabled').on(t.enabled)]
)

export const agentRuntimeSessionBindingsTable = sqliteTable(
  'agent_runtime_session_bindings',
  {
    session_id: text('session_id').notNull(),
    runtime_kind: text('runtime_kind').$type<AgentRuntimeKind>().notNull(),
    agent_id: text('agent_id'),
    runtime_session_id: text('runtime_session_id').notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    created_at: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    updated_at: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now())
      .$onUpdateFn(() => Date.now())
  },
  (t) => [
    primaryKey({ columns: [t.session_id, t.runtime_kind] }),
    foreignKey({
      columns: [t.session_id],
      foreignColumns: [sessionsTable.id],
      name: 'fk_agent_runtime_session_binding_session_id'
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.agent_id],
      foreignColumns: [agentsTable.id],
      name: 'fk_agent_runtime_session_binding_agent_id'
    }).onDelete('cascade'),
    index('idx_agent_runtime_session_bindings_agent_id').on(t.agent_id),
    index('idx_agent_runtime_session_bindings_runtime_session_id').on(t.runtime_session_id)
  ]
)

export const agentRuntimeSkillSyncsTable = sqliteTable(
  'agent_runtime_skill_syncs',
  {
    id: text('id').primaryKey(),
    agent_id: text('agent_id'),
    session_id: text('session_id'),
    skill_id: text('skill_id').notNull(),
    runtime_kind: text('runtime_kind').$type<AgentRuntimeKind>().notNull(),
    external_ref: text('external_ref'),
    checksum: text('checksum'),
    status: text('status').$type<RuntimeSkillSyncStatus>().notNull().default('pending'),
    last_error: text('last_error'),
    synced_at: integer('synced_at'),
    created_at: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    updated_at: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now())
      .$onUpdateFn(() => Date.now())
  },
  (t) => [
    foreignKey({
      columns: [t.agent_id],
      foreignColumns: [agentsTable.id],
      name: 'fk_agent_runtime_skill_sync_agent_id'
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.session_id],
      foreignColumns: [sessionsTable.id],
      name: 'fk_agent_runtime_skill_sync_session_id'
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.skill_id],
      foreignColumns: [skillsTable.id],
      name: 'fk_agent_runtime_skill_sync_skill_id'
    }).onDelete('cascade'),
    index('idx_agent_runtime_skill_syncs_agent_runtime').on(t.agent_id, t.runtime_kind),
    index('idx_agent_runtime_skill_syncs_session_runtime').on(t.session_id, t.runtime_kind),
    index('idx_agent_runtime_skill_syncs_skill').on(t.skill_id),
    index('idx_agent_runtime_skill_syncs_status').on(t.status)
  ]
)

export type AgentRuntimeProfileRow = typeof agentRuntimeProfilesTable.$inferSelect
export type InsertAgentRuntimeProfileRow = typeof agentRuntimeProfilesTable.$inferInsert
export type AgentRuntimeSettingsRow = typeof agentRuntimeSettingsTable.$inferSelect
export type InsertAgentRuntimeSettingsRow = typeof agentRuntimeSettingsTable.$inferInsert
export type AgentRuntimeSessionBindingRow = typeof agentRuntimeSessionBindingsTable.$inferSelect
export type InsertAgentRuntimeSessionBindingRow = typeof agentRuntimeSessionBindingsTable.$inferInsert
export type AgentRuntimeSkillSyncRow = typeof agentRuntimeSkillSyncsTable.$inferSelect
export type InsertAgentRuntimeSkillSyncRow = typeof agentRuntimeSkillSyncsTable.$inferInsert
