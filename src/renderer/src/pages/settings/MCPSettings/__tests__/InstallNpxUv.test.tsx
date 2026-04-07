import type { DependencyStatus } from '@shared/config/types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import InstallNpxUv from '../InstallNpxUv'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = (await importOriginal()) as { useTranslation: () => { t: (key: string) => string } }
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('../../index', () => ({
  SettingDescription: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
  SettingRow: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
  SettingSubtitle: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/components/Layout', () => ({
  Center: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  VStack: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

const renderWithRouter = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

const createStatus = (overrides: Partial<DependencyStatus>): DependencyStatus => ({
  name: 'uv',
  available: false,
  source: 'missing',
  resolvedPath: null,
  bundledPath: '/Users/test/.the-boss/bin/uv',
  environmentPath: null,
  installSupported: true,
  ...overrides
})

describe('InstallNpxUv', () => {
  beforeEach(() => {
    window.toast = {
      success: vi.fn(),
      error: vi.fn()
    } as any
    window.open = vi.fn()
    window.api = {
      dependencies: {
        getStatuses: vi.fn()
      },
      installUVBinary: vi.fn(),
      installBunBinary: vi.fn()
    } as any
  })

  it('shows environment-detected dependencies as available', async () => {
    vi.mocked(window.api.dependencies.getStatuses).mockResolvedValue([
      createStatus({
        name: 'uv',
        available: true,
        source: 'environment',
        resolvedPath: '/opt/homebrew/bin/uv',
        environmentPath: '/opt/homebrew/bin/uv'
      }),
      createStatus({
        name: 'bun',
        available: true,
        source: 'environment',
        resolvedPath: '/opt/homebrew/bin/bun',
        bundledPath: '/Users/test/.the-boss/bin/bun',
        environmentPath: '/opt/homebrew/bin/bun'
      })
    ])

    renderWithRouter(<InstallNpxUv />)

    await waitFor(() => {
      expect(screen.getByText('UV is available from environment.')).toBeInTheDocument()
      expect(screen.getByText('BUN is available from environment.')).toBeInTheDocument()
    })

    expect(screen.getByText('/opt/homebrew/bin/uv')).toBeInTheDocument()
    expect(screen.getByText('/opt/homebrew/bin/bun')).toBeInTheDocument()
  })

  it('re-queries dependency status after installation instead of relying on optimistic state', async () => {
    const getStatuses = vi.mocked(window.api.dependencies.getStatuses)
    getStatuses.mockResolvedValueOnce([
      createStatus({ name: 'uv' }),
      createStatus({ name: 'bun', bundledPath: '/Users/test/.the-boss/bin/bun' })
    ])
    getStatuses.mockResolvedValueOnce([
      createStatus({
        name: 'uv',
        available: true,
        source: 'bundled',
        resolvedPath: '/Users/test/.the-boss/bin/uv',
        bundledPath: '/Users/test/.the-boss/bin/uv'
      }),
      createStatus({ name: 'bun', bundledPath: '/Users/test/.the-boss/bin/bun' })
    ])

    renderWithRouter(<InstallNpxUv />)

    const user = userEvent.setup()
    const installButtons = await screen.findAllByRole('button', { name: 'settings.mcp.install' })
    await user.click(installButtons[0])

    await waitFor(() => {
      expect(window.api.installUVBinary).toHaveBeenCalledTimes(1)
      expect(window.api.dependencies.getStatuses).toHaveBeenCalledTimes(2)
      expect(screen.getByText('UV is installed by The Boss.')).toBeInTheDocument()
      expect(screen.getByText('/Users/test/.the-boss/bin/uv')).toBeInTheDocument()
    })
  })
})
