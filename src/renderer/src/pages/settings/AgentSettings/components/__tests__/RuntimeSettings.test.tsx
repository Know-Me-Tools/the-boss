import type { GetAgentSessionResponse, UpdateAgentBaseForm } from '@renderer/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as Antd from 'antd'
import type * as ReactI18Next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RuntimeSettings from '../RuntimeSettings'

const translate = vi.fn((_key: string, fallback?: string) => fallback ?? _key)

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof Antd>()
  return {
    ...actual,
    Alert: ({ message }: { message: string }) => <div role="status">{message}</div>,
    Button: ({ children, disabled, onClick }: { children: string; disabled?: boolean; onClick?: () => void }) => (
      <button type="button" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
    Input: ({
      value,
      onChange,
      placeholder,
      'aria-label': ariaLabel
    }: {
      value?: string | number
      onChange?: (event: { target: { value: string } }) => void
      placeholder?: string
      'aria-label'?: string
    }) => (
      <input
        aria-label={ariaLabel}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => onChange?.({ target: { value: event.target.value } })}
      />
    ),
    Select: ({
      value,
      options,
      onChange,
      'aria-label': ariaLabel
    }: {
      value?: string
      options: Array<{ value: string; label: string }>
      onChange?: (value: string) => void
      'aria-label'?: string
    }) => (
      <select aria-label={ariaLabel} value={value} onChange={(event) => onChange?.(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
    Switch: ({ checked, onChange, 'aria-label': ariaLabel }: any) => (
      <input
        aria-label={ariaLabel}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange?.(event.target.checked)}
      />
    ),
    Tag: ({ children }: { children: string }) => <span>{children}</span>
  }
})

vi.mock('react-i18next', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ReactI18Next
  return {
    ...actual,
    useTranslation: () => ({
      t: translate
    })
  }
})

describe('RuntimeSettings', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    translate.mockClear()
    window.api = {
      getAppInfo: vi.fn(async () => ({ notesPath: '/tmp/notes' })),
      agentRuntime: {
        listProfiles: vi.fn(async () => []),
        getStatus: vi.fn(async () => ({
          kind: 'uar',
          state: 'stopped',
          binarySource: 'bundled',
          message: 'UAR embedded sidecar is stopped.'
        })),
        installManagedBinary: vi.fn(async () => ({
          kind: 'uar',
          state: 'installed',
          binarySource: 'managed',
          message: 'Managed UAR binary is installed.'
        })),
        testConnection: vi.fn(async () => ({
          kind: 'uar',
          state: 'ready',
          endpoint: 'http://127.0.0.1:1906',
          message: 'UAR sidecar is ready.'
        })),
        listCodexModels: vi.fn(async () => createCodexModels()),
        listOpenCodeModels: vi.fn(async () => createOpenCodeModels())
      }
    } as never
  })

  it('renders UAR sidecar settings and persists nested runtime updates', () => {
    const update = vi.fn()
    render(<RuntimeSettings agentBase={createAgentBase('uar')} update={update} />)

    fireEvent.change(screen.getByLabelText('Sidecar port'), { target: { value: '1906' } })

    expect(screen.getByText('Skill sync')).toBeInTheDocument()
    expect(screen.getByLabelText('Binary path')).toBeInTheDocument()
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'session-id',
        configuration: expect.objectContaining({
          runtime: expect.objectContaining({
            kind: 'uar',
            sidecar: expect.objectContaining({
              port: 1906
            })
          })
        })
      } satisfies Partial<UpdateAgentBaseForm>),
      { showSuccessToast: false }
    )
  })

  it('renders Codex sandbox and approval settings', () => {
    render(<RuntimeSettings agentBase={createAgentBase('codex')} update={vi.fn()} />)

    expect(screen.getByLabelText('Sandbox mode')).toBeInTheDocument()
    expect(screen.getByLabelText('Approval policy')).toBeInTheDocument()
    expect(screen.getByLabelText('Network access')).toBeInTheDocument()
    expect(screen.getByLabelText('Reasoning effort')).toBeInTheDocument()
  })

  it('selecting Codex loads Codex models and prefers the CLI-only GPT-5.5 default', async () => {
    const update = vi.fn()
    render(<RuntimeSettings agentBase={createAgentBase('claude')} update={update} />)

    fireEvent.change(screen.getByLabelText('Runtime'), { target: { value: 'codex' } })

    await waitFor(() => expect(window.api.agentRuntime.listCodexModels).toHaveBeenCalled())
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          runtime: expect.objectContaining({
            kind: 'codex',
            modelId: 'gpt-5.5',
            reasoningEffort: 'medium'
          })
        })
      }),
      { showSuccessToast: false }
    )
  })

  it('preserves a valid Codex model selection when loading runtime models', async () => {
    const update = vi.fn()
    render(
      <RuntimeSettings
        agentBase={createAgentBase('codex', {
          modelId: 'gpt-5.1-codex',
          reasoningEffort: 'high'
        })}
        update={update}
      />
    )

    await waitFor(() => expect(window.api.agentRuntime.listCodexModels).toHaveBeenCalled())

    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          runtime: expect.objectContaining({
            modelId: 'gpt-5.2-codex'
          })
        })
      }),
      expect.anything()
    )
  })

  it('renders Codex model override as a closed set from the Codex CLI catalog', async () => {
    render(<RuntimeSettings agentBase={createAgentBase('codex')} update={vi.fn()} />)

    await screen.findByRole('option', { name: 'GPT-5.2 Codex' })
    const modelSelect = screen.getByLabelText('Model Override')

    expect(modelSelect.tagName).toBe('SELECT')
    expect(screen.queryByDisplayValue('not-a-codex-model')).not.toBeInTheDocument()
  })

  it('selecting OpenCode loads OpenCode models and replaces an invalid model with the default', async () => {
    const update = vi.fn()
    render(<RuntimeSettings agentBase={createAgentBase('claude')} update={update} />)

    fireEvent.change(screen.getByLabelText('Runtime'), { target: { value: 'opencode' } })

    await waitFor(() => expect(window.api.agentRuntime.listOpenCodeModels).toHaveBeenCalled())
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          runtime: expect.objectContaining({
            kind: 'opencode',
            modelId: 'openai/gpt-5.2'
          })
        })
      }),
      { showSuccessToast: false }
    )
  })

  it('preserves a valid OpenCode model selection when loading runtime models', async () => {
    const update = vi.fn()
    render(
      <RuntimeSettings
        agentBase={createAgentBase('opencode', {
          modelId: 'anthropic/claude-sonnet-4-5'
        })}
        update={update}
      />
    )

    await waitFor(() => expect(window.api.agentRuntime.listOpenCodeModels).toHaveBeenCalled())

    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          runtime: expect.objectContaining({
            modelId: 'openai/gpt-5.2'
          })
        })
      }),
      expect.anything()
    )
  })

  it('renders OpenCode model override as a closed set from the OpenCode catalog', async () => {
    render(<RuntimeSettings agentBase={createAgentBase('opencode')} update={vi.fn()} />)

    await screen.findByRole('option', { name: 'OpenAI / GPT 5.2' })
    const modelSelect = screen.getByLabelText('Model Override')

    expect(modelSelect.tagName).toBe('SELECT')
    expect(screen.queryByDisplayValue('not-an-opencode-model')).not.toBeInTheDocument()
  })

  it('calls the backend runtime health API when testing the selected runtime', async () => {
    render(<RuntimeSettings agentBase={createAgentBase('uar')} update={vi.fn()} />)

    fireEvent.click(screen.getByText('Test connection'))

    expect(window.api.agentRuntime.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'uar',
        mode: 'embedded'
      })
    )
    expect(await screen.findByText('UAR sidecar is ready.')).toBeInTheDocument()
  })

  it.each([
    ['not-installed', undefined, 'UAR embedded sidecar binary is not installed.', 'Not installed'],
    ['installed', 'managed', 'Managed binary is installed.', 'Managed binary'],
    ['downloading', 'managed', 'Downloading UAR managed binary...', 'Downloading'],
    ['verification-failed', 'managed', 'Managed UAR SHA-256 mismatch.', 'Verification failed'],
    ['update-available', 'managed', 'A managed binary update is available.', 'Update available'],
    ['stopped', 'bundled', 'Bundled UAR fallback is available.', 'Bundled fallback']
  ])('renders UAR managed binary status %s', async (state, binarySource, message, expectedLabel) => {
    vi.mocked(window.api.agentRuntime.getStatus).mockResolvedValueOnce({
      kind: 'uar',
      state,
      binarySource,
      message
    } as never)

    render(<RuntimeSettings agentBase={createAgentBase('uar')} update={vi.fn()} />)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByText(expectedLabel)).toBeInTheDocument()
  })

  it('calls the managed binary install action from UAR settings', async () => {
    vi.mocked(window.api.agentRuntime.getStatus).mockResolvedValueOnce({
      kind: 'uar',
      state: 'update-available',
      binarySource: 'managed',
      message: 'A managed binary update is available.'
    } as never)

    render(<RuntimeSettings agentBase={createAgentBase('uar')} update={vi.fn()} />)

    expect(await screen.findByText('A managed binary update is available.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Install/update'))

    expect(window.api.agentRuntime.installManagedBinary).toHaveBeenCalledWith({ name: 'universal-agent-runtime' })
    expect(await screen.findByText('Managed UAR binary is installed.')).toBeInTheDocument()
  })
})

function createAgentBase(
  kind: 'claude' | 'codex' | 'opencode' | 'uar',
  runtimeOverride: Record<string, unknown> = {}
): GetAgentSessionResponse {
  const runtime =
    kind === 'uar'
      ? {
          kind: 'uar' as const,
          mode: 'embedded' as const
        }
      : kind === 'claude'
        ? {
            kind: 'claude' as const,
            mode: 'managed' as const
          }
        : {
            kind,
            mode: 'managed' as const
          }

  return {
    id: 'session-id',
    agent_id: 'agent-id',
    agent_type: 'agent',
    name: 'Runtime Agent',
    accessible_paths: ['/tmp/workspace'],
    model: 'openai:gpt-5.2',
    created_at: '2026-04-17T20:00:00.000Z',
    updated_at: '2026-04-17T20:00:00.000Z',
    configuration: {
      permission_mode: 'default',
      max_turns: 100,
      env_vars: {},
      runtime: {
        ...runtime,
        ...runtimeOverride
      }
    }
  }
}

function createCodexModels() {
  return [
    {
      id: 'gpt-5.5',
      model: 'gpt-5.5',
      displayName: 'GPT-5.5',
      description: 'CLI-only Codex model',
      hidden: false,
      isDefault: false,
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'medium'
    },
    {
      id: 'gpt-5.2-codex',
      model: 'gpt-5.2-codex',
      displayName: 'GPT-5.2 Codex',
      description: 'Default Codex model',
      hidden: false,
      isDefault: true,
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'medium'
    },
    {
      id: 'gpt-5.1-codex',
      model: 'gpt-5.1-codex',
      displayName: 'GPT-5.1 Codex',
      description: 'Previous Codex model',
      hidden: false,
      isDefault: false,
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'medium'
    }
  ]
}

function createOpenCodeModels() {
  return [
    {
      id: 'openai/gpt-5.2',
      providerId: 'openai',
      modelId: 'gpt-5.2',
      displayName: 'GPT 5.2',
      providerName: 'OpenAI',
      hidden: false,
      isDefault: true,
      capabilities: {
        reasoning: true,
        toolcall: true
      }
    },
    {
      id: 'anthropic/claude-sonnet-4-5',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      displayName: 'Claude Sonnet 4.5',
      providerName: 'Anthropic',
      hidden: false,
      isDefault: false,
      capabilities: {
        reasoning: true,
        toolcall: true
      }
    }
  ]
}
