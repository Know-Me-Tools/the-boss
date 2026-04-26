import type { AgentBaseWithId, AgentRuntimeConfig, ApiModel } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { buildRuntimeAwareModelUpdate } from '../agentRuntimeModel'

const codexRuntime = {
  kind: 'codex',
  mode: 'managed',
  modelId: 'gpt-5.2-codex',
  reasoningEffort: 'medium'
} satisfies AgentRuntimeConfig

const openCodeRuntime = {
  kind: 'opencode',
  mode: 'managed',
  modelId: 'openai/gpt-5.2',
  agentName: 'build'
} satisfies AgentRuntimeConfig

describe('buildRuntimeAwareModelUpdate', () => {
  it('stores Codex CLI-only models in runtime configuration without updating the legacy model field', () => {
    const update = buildRuntimeAwareModelUpdate({
      base: createBase(codexRuntime),
      selectedModel: createModel('gpt-5.5'),
      effectiveRuntime: codexRuntime
    })

    expect(update).toEqual({
      id: 'base-id',
      configuration: expect.objectContaining({
        runtime: expect.objectContaining({
          kind: 'codex',
          modelId: 'gpt-5.5'
        })
      })
    })
    expect(update).not.toHaveProperty('model')
  })

  it('stores OpenCode models in runtime configuration without updating the legacy model field', () => {
    const update = buildRuntimeAwareModelUpdate({
      base: createBase(openCodeRuntime),
      selectedModel: createModel('anthropic/claude-sonnet-4-5'),
      effectiveRuntime: openCodeRuntime
    })

    expect(update).toEqual({
      id: 'base-id',
      configuration: expect.objectContaining({
        runtime: expect.objectContaining({
          kind: 'opencode',
          modelId: 'anthropic/claude-sonnet-4-5'
        })
      })
    })
    expect(update).not.toHaveProperty('model')
  })

  it('materializes an inherited runtime on the session before setting the runtime model', () => {
    const update = buildRuntimeAwareModelUpdate({
      base: createBase(undefined),
      selectedModel: createModel('gpt-5.5'),
      effectiveRuntime: codexRuntime
    })

    expect(update.configuration?.runtime).toEqual(
      expect.objectContaining({
        kind: 'codex',
        mode: 'managed',
        modelId: 'gpt-5.5',
        reasoningEffort: 'medium'
      })
    )
    expect(update).not.toHaveProperty('model')
  })

  it('keeps provider models on the legacy model field for non-runtime selections', () => {
    const update = buildRuntimeAwareModelUpdate({
      base: createBase({ kind: 'claude', mode: 'managed' }),
      selectedModel: createModel('openai:gpt-5.2')
    })

    expect(update).toEqual({
      id: 'base-id',
      model: 'openai:gpt-5.2'
    })
  })
})

function createBase(runtime?: AgentRuntimeConfig): AgentBaseWithId {
  return {
    id: 'base-id',
    name: 'Runtime Agent',
    accessible_paths: ['/tmp/workspace'],
    model: 'openai:gpt-5.2',
    configuration: runtime
      ? {
          permission_mode: 'default',
          max_turns: 100,
          env_vars: {},
          runtime
        }
      : undefined
  }
}

function createModel(id: string): ApiModel {
  return {
    id,
    object: 'model',
    created: 0,
    name: id,
    owned_by: 'test',
    provider: 'test',
    provider_name: 'Test',
    provider_model_id: id
  }
}
