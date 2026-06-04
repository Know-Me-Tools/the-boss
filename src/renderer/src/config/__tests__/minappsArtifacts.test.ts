import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('default mini apps', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(window as any).api = {
      file: {
        read: vi.fn().mockRejectedValue(new Error('missing custom minapps')),
        writeWithId: vi.fn().mockResolvedValue(undefined)
      }
    }
  })

  it('registers artifacts as a route-backed internal mini-app', async () => {
    const { ORIGIN_DEFAULT_MIN_APPS } = await import('../minapps')

    expect(ORIGIN_DEFAULT_MIN_APPS[0]).toMatchObject({
      id: 'artifacts',
      nameKey: 'minapps.artifacts',
      url: '/artifacts',
      route: '/artifacts',
      supportedRegions: ['CN', 'Global']
    })
  })
})
