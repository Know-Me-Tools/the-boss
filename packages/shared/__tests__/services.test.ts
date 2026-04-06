import { describe, expect, it } from 'vitest'

import {
  buildServiceToolId,
  ImportSupabaseServiceRequestSchema,
  ServiceDefinitionSchema,
  ServiceToolProjectionKindSchema
} from '../services'

describe('services schema', () => {
  it('accepts Supabase imports as a first-class shared service request', () => {
    expect(
      ImportSupabaseServiceRequestSchema.parse({
        name: 'Prod Supabase',
        endpoint: 'https://example.supabase.co',
        anonKey: {
          label: 'Anon',
          value: 'anon-secret'
        },
        serviceRoleKey: {
          label: 'Service role',
          value: 'service-role-secret'
        }
      })
    ).toMatchObject({
      name: 'Prod Supabase',
      endpoint: 'https://example.supabase.co'
    })
  })

  it('parses Supabase service definitions with stable projected tool ids', () => {
    const service = ServiceDefinitionSchema.parse({
      serviceId: 'svc_supabase',
      name: 'Prod Supabase',
      kind: 'supabase',
      endpoint: 'https://example.supabase.co',
      importSource: {
        type: 'manual',
        locator: 'https://example.supabase.co',
        importedAt: '2026-04-05T00:00:00.000Z'
      },
      auth: {
        type: 'none'
      },
      headerTemplates: [],
      projectedTools: [
        {
          id: 'rest',
          kind: 'supabase-rest',
          sourceOperationId: 'rest',
          name: 'Supabase REST',
          description: 'Brokered Supabase REST access.',
          enabled: true,
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string'
              }
            },
            required: ['path']
          },
          additionalHeaders: []
        }
      ],
      createdAt: '2026-04-05T00:00:00.000Z',
      updatedAt: '2026-04-05T00:00:00.000Z',
      refresh: {},
      metadata: {},
      anonKey: {
        id: 'secret_anon',
        label: 'Anon'
      },
      serviceRoleKey: {
        id: 'secret_service_role',
        label: 'Service role'
      },
      operations: [
        {
          id: 'rest',
          kind: 'rest',
          pathPrefix: '/rest/v1',
          description: 'Brokered Supabase REST access.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string'
              }
            },
            required: ['path']
          }
        }
      ]
    })

    expect(service.kind).toBe('supabase')
    expect(service.projectedTools[0].kind).toBe(ServiceToolProjectionKindSchema.parse('supabase-rest'))
    expect(buildServiceToolId(service.serviceId, service.projectedTools[0].id)).toBe('service__svc_supabase__rest')
  })
})
