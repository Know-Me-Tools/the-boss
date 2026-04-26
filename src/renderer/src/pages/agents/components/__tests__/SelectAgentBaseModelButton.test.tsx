import type { AgentBaseWithId } from '@renderer/types'
import { render, screen } from '@testing-library/react'
import type * as Antd from 'antd'
import type * as ReactI18Next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import SelectAgentBaseModelButton from '../SelectAgentBaseModelButton'

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof Antd>()
  return {
    ...actual,
    Button: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>
  }
})

vi.mock('react-i18next', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ReactI18Next
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback ?? 'Select model'
    })
  }
})

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

vi.mock('@renderer/hooks/agents/useModel', () => ({
  useApiModel: () => ({
    id: 'openai:gpt-5.2',
    object: 'model',
    created: 0,
    name: 'GPT-5.2',
    owned_by: 'OpenAI',
    provider: 'openai',
    provider_name: 'OpenAI',
    provider_model_id: 'gpt-5.2'
  })
}))

vi.mock('@renderer/services/ProviderService', () => ({
  getProviderNameById: () => 'OpenAI'
}))

describe('SelectAgentBaseModelButton', () => {
  it('shows the Codex runtime model instead of the legacy provider model', () => {
    render(<SelectAgentBaseModelButton agentBase={createAgentBase()} onSelect={vi.fn()} />)

    expect(screen.getByText('gpt-5.5 | Codex')).toBeInTheDocument()
    expect(screen.queryByText(/GPT-5.2/)).not.toBeInTheDocument()
  })
})

function createAgentBase(): AgentBaseWithId {
  return {
    id: 'agent-id',
    name: 'Runtime Agent',
    accessible_paths: ['/tmp/workspace'],
    model: 'openai:gpt-5.2',
    configuration: {
      permission_mode: 'default',
      max_turns: 100,
      env_vars: {},
      runtime: {
        kind: 'codex',
        mode: 'managed',
        modelId: 'gpt-5.5'
      }
    }
  }
}
