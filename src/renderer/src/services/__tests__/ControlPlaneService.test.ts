import { SYSTEM_MODELS } from '@renderer/config/models/default'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mockLogger
  }
}))

import {
  __resetControlPlaneServiceCacheForTests,
  getControlPlaneCatalogModels,
  getControlPlaneHealth
} from '../ControlPlaneService'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('ControlPlaneService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetControlPlaneServiceCacheForTests()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('returns typed health status when the control plane is available', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 'ok', service: 'the-boss-control-plane' }))

    const health = await getControlPlaneHealth()

    expect(health).toEqual({
      available: true,
      status: 'ok',
      service: 'the-boss-control-plane'
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.know-me.tools/health',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    )
  })

  it('returns mapped catalog models when the control plane catalog is valid', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        models: [
          {
            id: 'theboss-fast',
            name: 'The Boss Fast',
            provider: 'theboss',
            group: 'The Boss',
            owned_by: 'know-me',
            description: 'Fast control-plane default'
          }
        ]
      })
    )

    const models = await getControlPlaneCatalogModels()

    expect(models).toEqual([
      {
        id: 'theboss-fast',
        name: 'The Boss Fast',
        provider: 'theboss',
        group: 'The Boss',
        owned_by: 'know-me',
        description: 'Fast control-plane default'
      }
    ])
  })

  it('returns fallback models and logs a warning on network errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))

    const models = await getControlPlaneCatalogModels()

    expect(models).toEqual(SYSTEM_MODELS.theboss)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Control-plane model catalog unavailable; using static The Boss fallback catalog',
      expect.any(Error)
    )
  })

  it('returns fallback models when the catalog response is malformed', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ models: [{ name: 'missing id' }] }))

    const models = await getControlPlaneCatalogModels()

    expect(models).toEqual(SYSTEM_MODELS.theboss)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Control-plane model catalog unavailable; using static The Boss fallback catalog',
      expect.any(Error)
    )
  })
})
