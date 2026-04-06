import type { ServiceDefinition } from '@shared/services'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ServicesSettings from '..'

const mocks = vi.hoisted(() => {
  const services: ServiceDefinition[] = [
    {
      serviceId: 'svc-openapi',
      name: 'Petstore',
      kind: 'openapi',
      endpoint: 'https://api.example.com',
      importSource: {
        type: 'url',
        locator: 'https://api.example.com/openapi.json',
        importedAt: '2026-04-05T00:00:00.000Z'
      },
      auth: { type: 'none' },
      headerTemplates: [],
      projectedTools: [
        {
          id: 'listPets',
          kind: 'openapi-operation',
          sourceOperationId: 'listPets',
          name: 'List Pets',
          description: 'List pets',
          enabled: true,
          inputSchema: {},
          additionalHeaders: []
        }
      ],
      createdAt: '2026-04-05T00:00:00.000Z',
      updatedAt: '2026-04-05T00:00:00.000Z',
      refresh: { lastImportedAt: '2026-04-05T00:00:00.000Z' },
      metadata: {},
      serverUrls: ['https://api.example.com'],
      specSnapshot: '{}',
      operations: [
        {
          id: 'listPets',
          method: 'get',
          path: '/pets',
          operationId: 'listPets',
          inputSchema: {},
          security: []
        }
      ]
    },
    {
      serviceId: 'svc-supabase',
      name: 'Prod Database',
      kind: 'supabase',
      endpoint: 'https://project.supabase.co',
      importSource: { type: 'manual', locator: 'https://project.supabase.co', importedAt: '2026-04-05T00:00:00.000Z' },
      auth: { type: 'none' },
      headerTemplates: [],
      projectedTools: [
        {
          id: 'rest',
          kind: 'supabase-rest',
          sourceOperationId: 'rest',
          name: 'Supabase REST',
          description: 'Brokered rest access',
          enabled: false,
          inputSchema: {},
          additionalHeaders: []
        }
      ],
      createdAt: '2026-04-05T00:00:00.000Z',
      updatedAt: '2026-04-05T00:00:00.000Z',
      refresh: { lastImportedAt: '2026-04-05T00:00:00.000Z' },
      metadata: {},
      anonKey: { id: 'secret-anon', label: 'Anon key' },
      serviceRoleKey: { id: 'secret-service', label: 'Service role key' },
      operations: [
        {
          id: 'rest',
          kind: 'rest',
          pathPrefix: '/rest/v1',
          inputSchema: {}
        }
      ]
    }
  ]

  return {
    services,
    importOpenAPI: vi.fn(),
    importGraphQL: vi.fn(),
    importSupabase: vi.fn(),
    updateService: vi.fn(),
    deleteService: vi.fn(),
    reload: vi.fn()
  }
})

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: {} })
}))

vi.mock('@renderer/hooks/useServices', () => ({
  useServices: () => ({
    services: mocks.services,
    loading: false,
    importOpenAPI: mocks.importOpenAPI,
    importGraphQL: mocks.importGraphQL,
    importSupabase: mocks.importSupabase,
    updateService: mocks.updateService,
    deleteService: mocks.deleteService,
    reload: mocks.reload
  })
}))

function renderPage(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/settings/services" element={<ServicesSettings />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ServicesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        services: {
          testConnection: vi.fn().mockResolvedValue({ ok: true, status: 200 })
        }
      }
    })
  })

  it('renders a master-detail service manager and switches detail when a registry item is selected', async () => {
    renderPage('/settings/services?id=svc-openapi')

    expect(screen.getByDisplayValue('Petstore')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Prod Database'))

    await waitFor(() => {
      expect(screen.getByDisplayValue('Prod Database')).toBeInTheDocument()
    })

    expect(screen.getByText('Brokered REST')).toBeInTheDocument()
  })

  it('opens the kind picker and enters create mode in the same editor surface', async () => {
    renderPage('/settings/services?id=svc-openapi')

    fireEvent.click(screen.getByRole('button', { name: 'Add Service' }))
    fireEvent.click(screen.getByRole('button', { name: /Supabase Register a brokered Supabase/i }))

    await waitFor(() => {
      expect(screen.getByText('Create Supabase Service')).toBeInTheDocument()
    })

    expect(screen.getByPlaceholderText('Supabase project URL')).toBeInTheDocument()
  })

  it('restores create mode from search params', () => {
    renderPage('/settings/services?mode=new&kind=graphql')

    expect(screen.getByText('Create GraphQL Service')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('GraphQL endpoint')).toBeInTheDocument()
  })
})
