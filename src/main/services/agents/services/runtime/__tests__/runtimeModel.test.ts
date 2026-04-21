import {
  AgentEntitySchema,
  AgentRuntimeConfigSchema,
  type AgentRuntimeKind,
  type GetAgentSessionResponse
} from '@types'
import { describe, expect, it } from 'vitest'

import { resolveRuntimeCompatibility, resolveRuntimeKind, RUNTIME_CAPABILITY_MATRIX } from '../types'

const runtimeKinds: AgentRuntimeKind[] = ['claude', 'codex', 'opencode', 'uar']

describe('runtime agent model foundation', () => {
  it('accepts runtime-agnostic agent rows while preserving legacy Claude rows', () => {
    const baseAgent = {
      id: 'agent-runtime',
      name: 'Runtime Agent',
      accessible_paths: ['/tmp/workspace'],
      model: 'openai:gpt-5.2',
      created_at: '2026-04-17T20:00:00.000Z',
      updated_at: '2026-04-17T20:00:00.000Z'
    }

    expect(AgentEntitySchema.parse({ ...baseAgent, type: 'agent' }).type).toBe('agent')
    expect(AgentEntitySchema.parse({ ...baseAgent, type: 'claude-code' }).type).toBe('claude-code')
  })

  it('defaults omitted runtime config to Claude managed mode', () => {
    expect(AgentRuntimeConfigSchema.parse({})).toMatchObject({
      kind: 'claude',
      mode: 'managed'
    })
  })

  it('defines explicit capabilities for every supported runtime', () => {
    expect(Object.keys(RUNTIME_CAPABILITY_MATRIX).sort()).toEqual([...runtimeKinds].sort())
    for (const kind of runtimeKinds) {
      expect(RUNTIME_CAPABILITY_MATRIX[kind]).toEqual(
        expect.objectContaining({
          tools: expect.any(Boolean),
          mcp: expect.any(Boolean),
          skills: expect.any(Boolean),
          knowledge: expect.any(Boolean),
          resume: expect.any(Boolean)
        })
      )
    }
  })

  it('reports compatibility warnings without invoking a runtime', () => {
    const session = createSession({
      configuration: {
        permission_mode: 'default',
        max_turns: 100,
        env_vars: {},
        runtime: {
          kind: 'codex',
          mode: 'managed'
        },
        context_strategy: {
          type: 'summarize'
        }
      },
      mcps: ['server-id'],
      allowed_tools: ['mcp__server__tool'],
      knowledge_bases: [{ id: 'kb-1' } as never],
      knowledgeRecognition: 'on'
    })

    expect(resolveRuntimeKind(session)).toBe('codex')

    const result = resolveRuntimeCompatibility(session)

    expect(result.kind).toBe('codex')
    expect(result.compatible).toBe(true)
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'runtime.compaction.unsupported',
          capability: 'compaction'
        })
      ])
    )
  })

  it('does not claim UAR supports approval-gated sessions', () => {
    const session = createSession({
      configuration: {
        permission_mode: 'default',
        max_turns: 100,
        env_vars: {},
        runtime: {
          kind: 'uar',
          mode: 'embedded'
        }
      }
    })

    const result = resolveRuntimeCompatibility(session)

    expect(result.kind).toBe('uar')
    expect(result.capabilities.approvals).toBe(false)
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'runtime.approvals.unsupported',
          capability: 'approvals'
        })
      ])
    )
  })
})

function createSession(overrides: Partial<GetAgentSessionResponse>): GetAgentSessionResponse {
  return {
    id: 'session-id',
    agent_id: 'agent-id',
    agent_type: 'agent',
    name: 'Session',
    accessible_paths: ['/tmp/workspace'],
    model: 'openai:gpt-5.2',
    created_at: '2026-04-17T20:00:00.000Z',
    updated_at: '2026-04-17T20:00:00.000Z',
    ...overrides
  }
}
