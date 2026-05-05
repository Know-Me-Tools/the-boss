import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as Antd from 'antd'
import type * as ReactI18Next from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentRuntimeSettings from '../AgentRuntimeSettings'

const translate = vi.fn((_key: string, fallback?: string, options?: Record<string, string>) => {
  if (!fallback) {
    return _key
  }
  return Object.entries(options ?? {}).reduce((value, [key, replacement]) => {
    return value.replace(`{{${key}}}`, replacement)
  }, fallback)
})

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
    Input: ({ value, 'aria-label': ariaLabel }: { value?: string; 'aria-label'?: string }) => (
      <input aria-label={ariaLabel} readOnly value={value ?? ''} />
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

describe('AgentRuntimeSettings', () => {
  beforeEach(() => {
    translate.mockClear()
    window.api = {
      agentRuntime: {
        getSettings: vi.fn(async (kind: string) => ({
          kind,
          enabled: true,
          config: {
            kind,
            mode: kind === 'uar' ? 'embedded' : 'managed'
          }
        })),
        upsertSettings: vi.fn(async (settings: unknown) => settings),
        getStatus: vi.fn(async (config: { kind: string }) => ({
          kind: config.kind,
          state: config.kind === 'claude' ? 'ready' : 'missing-binary',
          message:
            config.kind === 'claude'
              ? 'Claude Code runtime uses the existing implementation.'
              : `${config.kind} executable was not found.`
        })),
        discoverBinary: vi.fn(async (kind: string) => ({
          kind,
          command: kind === 'uar' ? 'universal-agent-runtime' : kind,
          detectedPath: kind === 'codex' ? '/usr/local/bin/codex' : undefined,
          version: kind === 'codex' ? 'codex 1.0.0' : undefined,
          source: 'path',
          available: kind === 'codex',
          message: kind === 'codex' ? 'codex was detected on PATH at /usr/local/bin/codex.' : `${kind} missing`
        })),
        installManagedBinary: vi.fn()
      },
      dependencies: {
        getStatuses: vi.fn(async () => [])
      },
      installRustToolchain: vi.fn(async () => undefined),
      file: {
        select: vi.fn(async () => [])
      }
    } as never
  })

  it('shows detected runtime binaries and saves them as global overrides', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/agent-runtimes?runtime=codex']}>
        <AgentRuntimeSettings />
      </MemoryRouter>
    )

    expect(await screen.findByText('Detected on PATH: /usr/local/bin/codex')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Use detected binary'))

    await waitFor(() => {
      expect(window.api.agentRuntime.upsertSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'codex',
          enabled: true,
          config: expect.objectContaining({
            kind: 'codex',
            sidecar: expect.objectContaining({
              binaryPath: '/usr/local/bin/codex'
            })
          })
        })
      )
    })
  })
})
