import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import OpenAIOAuthSettings from '../OpenAIOAuthSettings'

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        {
          'settings.provider.openai.oauth.warning_title': 'Warning',
          'settings.provider.openai.oauth.warning_description': 'OAuth proxy warning',
          'settings.provider.openai.oauth.credential_status': 'Credential status',
          'settings.provider.openai.oauth.install_status': 'Install status',
          'settings.provider.openai.oauth.proxy_status': 'Proxy status',
          'settings.provider.openai.oauth.health_status': 'Health status',
          'settings.provider.openai.oauth.local_endpoint': 'Local endpoint',
          'settings.provider.openai.oauth.auth_file': 'Auth file',
          'settings.provider.openai.oauth.available_models': 'Available models',
          'settings.provider.openai.oauth.refresh': 'Refresh',
          'settings.provider.openai.oauth.check': 'Check sidecar',
          'settings.provider.openai.oauth.install': 'Install',
          'settings.provider.openai.oauth.start': 'Start',
          'settings.provider.openai.oauth.stop': 'Stop',
          'settings.provider.openai.oauth.port': 'Local port',
          'settings.provider.openai.oauth.save_port': 'Save port',
          'settings.provider.openai.oauth.port_saved': 'Port saved',
          'settings.provider.openai.oauth.startup_failed': 'Proxy startup failed',
          'settings.provider.openai.oauth.details': 'Details',
          'settings.provider.openai.oauth.show_details': 'Show details',
          'settings.provider.openai.oauth.hide_details': 'Hide details',
          'settings.provider.openai.oauth.state.valid': 'Valid',
          'settings.provider.openai.oauth.state.installed': 'Installed',
          'settings.provider.openai.oauth.state.running': 'Running',
          'settings.provider.openai.oauth.state.healthy': 'Healthy',
          'settings.provider.openai.oauth.action_success': 'Action succeeded',
          'settings.provider.openai.oauth.action_failed': 'Action failed'
        } as Record<string, string>
      )[key] ?? key
  })
}))

vi.mock('antd', () => ({
  Alert: ({ message, description }: { message?: ReactNode; description?: ReactNode }) => (
    <div>
      {message}
      {description}
    </div>
  ),
  Button: ({
    children,
    disabled,
    onClick
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => (
    <button disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  ),
  InputNumber: ({
    value,
    onChange,
    min,
    max
  }: {
    value?: number | null
    onChange?: (value: number | null) => void
    min?: number
    max?: number
  }) => (
    <input
      aria-label="Local port"
      max={max}
      min={min}
      type="number"
      value={value ?? ''}
      onChange={(event) => onChange?.(Number(event.target.value))}
    />
  ),
  Space: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

describe('OpenAIOAuthSettings', () => {
  const getStatus = vi.fn()
  const getConfig = vi.fn()
  const setConfig = vi.fn()
  const startProxy = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    getStatus.mockResolvedValue({
      installState: 'installed',
      runState: 'running',
      healthState: 'healthy',
      credentialStatus: { state: 'valid', authFilePath: '/mock/codex/auth.json' },
      host: '127.0.0.1',
      port: 10531,
      baseUrl: 'http://127.0.0.1:10531/v1',
      availableModels: ['gpt-5.4']
    })
    getConfig.mockResolvedValue(11555)
    setConfig.mockResolvedValue(undefined)
    startProxy.mockResolvedValue({ success: true })

    ;(window as any).api = {
      ...(window as any).api,
      config: {
        get: getConfig,
        set: setConfig
      },
      openai_oauth: {
        getStatus,
        install: vi.fn(),
        startProxy,
        checkHealth: vi.fn(),
        stopProxy: vi.fn()
      }
    }
    ;(window as any).toast = {
      success: vi.fn(),
      error: vi.fn()
    }
  })

  it('loads and saves the configurable OAuth proxy port', async () => {
    render(<OpenAIOAuthSettings />)

    await waitFor(() => {
      expect(getConfig).toHaveBeenCalledWith('openAIOAuthPort')
    })

    const input = await screen.findByLabelText('Local port')
    expect(input).toHaveValue(11555)

    fireEvent.change(input, { target: { value: '12456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save port' }))

    await waitFor(() => {
      expect(setConfig).toHaveBeenCalledWith('openAIOAuthPort', 12456)
    })
  })

  it('renders the check sidecar action label from locale keys', async () => {
    render(<OpenAIOAuthSettings />)

    expect(await screen.findByRole('button', { name: 'Check sidecar' })).toBeInTheDocument()
  })

  it('shows persisted startup diagnostics after a failed proxy start', async () => {
    getStatus
      .mockResolvedValueOnce({
        installState: 'installed',
        runState: 'running',
        healthState: 'healthy',
        credentialStatus: { state: 'valid', authFilePath: '/mock/codex/auth.json' },
        host: '127.0.0.1',
        port: 10531,
        baseUrl: 'http://127.0.0.1:10531/v1',
        availableModels: ['gpt-5.4']
      })
      .mockResolvedValueOnce({
        installState: 'installed',
        runState: 'error',
        healthState: 'unhealthy',
        credentialStatus: { state: 'valid', authFilePath: '/mock/codex/auth.json' },
        host: '127.0.0.1',
        port: 10531,
        baseUrl: 'http://127.0.0.1:10531/v1',
        availableModels: [],
        message: 'Proxy exited before becoming healthy (code 1).',
        diagnostics: {
          source: 'stderr',
          summary: 'Proxy exited before becoming healthy (code 1).',
          details: 'stderr:\nfetch failed',
          updatedAt: '2026-04-13T12:00:00.000Z'
        }
      })
    startProxy.mockResolvedValue({
      success: false,
      message: 'Proxy exited before becoming healthy (code 1).',
      diagnostics: {
        source: 'stderr',
        summary: 'Proxy exited before becoming healthy (code 1).',
        details: 'stderr:\nfetch failed',
        updatedAt: '2026-04-13T12:00:00.000Z'
      }
    })

    render(<OpenAIOAuthSettings />)

    expect(await screen.findByText('/mock/codex/auth.json')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))

    await waitFor(() => {
      expect(startProxy).toHaveBeenCalledTimes(1)
    })

    expect(await screen.findByText('Proxy startup failed')).toBeInTheDocument()
    expect(screen.getByText('Proxy exited before becoming healthy (code 1).')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show details' }))

    expect(await screen.findByText('Details')).toBeInTheDocument()
    expect(screen.getByText(/stderr:/)).toBeInTheDocument()
    expect(window.toast.error).toHaveBeenCalledWith('Proxy exited before becoming healthy (code 1).')
  })
})
