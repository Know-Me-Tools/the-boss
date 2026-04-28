import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReduxDispatch, mockReduxSelect } = vi.hoisted(() => ({
  mockReduxDispatch: vi.fn(),
  mockReduxSelect: vi.fn()
}))

vi.mock('@main/services/ReduxService', () => ({
  reduxService: {
    select: mockReduxSelect,
    dispatch: mockReduxDispatch
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn()
    })
  }
}))

describe('apiServer config', () => {
  beforeEach(() => {
    vi.resetModules()
    mockReduxDispatch.mockReset()
    mockReduxSelect.mockReset()
  })

  it('loads the persisted API server config from Redux', async () => {
    mockReduxSelect.mockResolvedValue({
      apiServer: {
        enabled: true,
        host: '127.0.0.1',
        port: 21334,
        apiKey: 'cs-sk-existing'
      }
    })

    const { config } = await import('../config')
    await expect(config.load()).resolves.toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 21334,
      apiKey: 'cs-sk-existing'
    })
  })

  it('patches the cached config without reloading from Redux', async () => {
    mockReduxSelect.mockResolvedValue({
      apiServer: {
        enabled: true,
        host: '127.0.0.1',
        port: 21334,
        apiKey: 'cs-sk-existing'
      }
    })

    const { config } = await import('../config')
    await config.load()

    await expect(config.set({ port: 21335 })).resolves.toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 21335,
      apiKey: 'cs-sk-existing'
    })
    expect(mockReduxSelect).toHaveBeenCalledTimes(1)
  })
})
