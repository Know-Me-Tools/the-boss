import type { ArtifactSettings } from '@shared/artifacts'
import type { ServiceDefinition, ServiceToolSummary } from '@shared/services'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ArtifactSettingsPage from '..'

const mocks = vi.hoisted(() => ({
  settings: {
    defaultHtmlRuntimeProfileId: 'html+htmx',
    defaultReactRuntimeProfileId: 'react-default',
    defaultThemeId: 'boss-light',
    accessPolicy: {
      internetEnabled: true,
      serviceIds: [],
      serviceToolIds: []
    },
    exposePackageRegistry: true,
    baseCss: '',
    customCss: ''
  } as ArtifactSettings,
  services: [] as ServiceDefinition[],
  serviceTools: [] as ServiceToolSummary[],
  updateSettings: vi.fn()
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'dark' })
}))

vi.mock('@renderer/hooks/useArtifactSettings', () => ({
  useArtifactSettings: () => ({
    settings: mocks.settings,
    loading: false,
    updateSettings: mocks.updateSettings
  })
}))

vi.mock('@renderer/hooks/useServices', () => ({
  useServices: () => ({
    services: mocks.services,
    loading: false
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (typeof options?.count === 'number') {
        return `${key}:${options.count}`
      }

      return key
    }
  })
}))

vi.mock('../ArtifactLibrarySection', () => ({
  default: () => <div data-testid="artifact-library-section" />
}))

function makeService(): ServiceDefinition {
  return {
    serviceId: 'svc-1',
    name: 'Warehouse API',
    kind: 'openapi',
    importSource: {
      type: 'url',
      locator: 'https://example.com/openapi.json',
      importedAt: '2026-06-04T00:00:00.000Z'
    },
    endpoint: 'https://api.example.com',
    auth: {
      type: 'none'
    },
    headerTemplates: [],
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    refresh: {},
    metadata: {},
    serverUrls: ['https://api.example.com'],
    specSnapshot: '{}',
    projectedTools: [
      {
        id: 'projection-1',
        kind: 'openapi-operation',
        sourceOperationId: 'listProducts',
        name: 'List products',
        description: 'List product inventory',
        enabled: true,
        inputSchema: {},
        additionalHeaders: []
      }
    ],
    operations: []
  }
}

function makeServiceTool(): ServiceToolSummary {
  return {
    id: 'tool-1',
    name: 'List products',
    description: 'List product inventory',
    serviceId: 'svc-1',
    serviceName: 'Warehouse API',
    serviceKind: 'openapi',
    sourceOperationId: 'listProducts',
    inputSchema: {},
    projectionKind: 'openapi-operation'
  }
}

function renderSettingsPage() {
  return render(
    <MemoryRouter>
      <ArtifactSettingsPage />
    </MemoryRouter>
  )
}

describe('ArtifactSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.settings = {
      defaultHtmlRuntimeProfileId: 'html+htmx',
      defaultReactRuntimeProfileId: 'react-default',
      defaultThemeId: 'boss-light',
      accessPolicy: {
        internetEnabled: true,
        serviceIds: [],
        serviceToolIds: []
      },
      exposePackageRegistry: true,
      baseCss: '',
      customCss: ''
    }
    mocks.services = [makeService()]
    mocks.serviceTools = [makeServiceTool()]
    mocks.updateSettings.mockImplementation(
      (updater: ArtifactSettings | ((prev: ArtifactSettings) => ArtifactSettings)) =>
        typeof updater === 'function' ? updater(mocks.settings) : updater
    )

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        artifacts: {
          getRuntimeProfiles: vi.fn().mockResolvedValue({
            html: [{ id: 'html+htmx', label: 'HTML + HTMX' }],
            react: [{ id: 'react-default', label: 'React default' }]
          }),
          getThemes: vi.fn().mockResolvedValue([{ id: 'boss-light', label: 'Boss Light' }]),
          getPackageRegistry: vi.fn().mockResolvedValue([])
        },
        services: {
          listProjectedTools: vi.fn().mockResolvedValue(mocks.serviceTools)
        }
      }
    })

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    })

    Object.defineProperty(window, 'getComputedStyle', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        getPropertyValue: vi.fn().mockReturnValue('0px')
      })
    })
  })

  it('renders service access and projected tool copy through i18n keys', async () => {
    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText('List products')).toBeInTheDocument()
    })

    expect(screen.getByText('settings.artifacts.service_access_title')).toBeInTheDocument()
    expect(screen.getByText('settings.artifacts.open_services')).toBeInTheDocument()
    expect(screen.getByText('settings.artifacts.service_access_description')).toBeInTheDocument()
    expect(screen.getByText('settings.artifacts.legacy_service_access')).toBeInTheDocument()
    expect(screen.getByText('settings.artifacts.projected_service_tools')).toBeInTheDocument()
    expect(screen.getByText('settings.artifacts.projected_service_tools_description')).toBeInTheDocument()
    expect(screen.getByText('settings.artifacts.projected_tools_count:1')).toBeInTheDocument()
    expect(screen.getAllByText('settings.artifacts.blocked')).toHaveLength(2)

    expect(screen.queryByText('Shared Service Access')).not.toBeInTheDocument()
    expect(screen.queryByText('Open Services')).not.toBeInTheDocument()
    expect(screen.queryByText('Legacy Service Access')).not.toBeInTheDocument()
    expect(screen.queryByText('Projected Service Tools')).not.toBeInTheDocument()
    expect(screen.queryByText('Allowed')).not.toBeInTheDocument()
    expect(screen.queryByText('Blocked')).not.toBeInTheDocument()
  })

  it('updates existing artifact access policy fields for services and projected tools', async () => {
    renderSettingsPage()

    await waitFor(() => {
      expect(screen.getByText('List products')).toBeInTheDocument()
    })

    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[2])
    fireEvent.click(switches[3])

    expect(mocks.updateSettings).toHaveBeenCalledTimes(2)
    expect(mocks.updateSettings.mock.results[0]?.value.accessPolicy.serviceIds).toEqual(['svc-1'])
    expect(mocks.updateSettings.mock.results[0]?.value.accessPolicy.serviceToolIds).toEqual([])
    expect(mocks.updateSettings.mock.results[1]?.value.accessPolicy.serviceIds).toEqual([])
    expect(mocks.updateSettings.mock.results[1]?.value.accessPolicy.serviceToolIds).toEqual(['tool-1'])
  })
})
