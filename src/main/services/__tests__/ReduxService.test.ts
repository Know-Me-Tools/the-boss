import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCacheRemove, mockExecuteJavaScript, mockGetMainWindow } = vi.hoisted(() => ({
  mockCacheRemove: vi.fn(),
  mockExecuteJavaScript: vi.fn().mockResolvedValue(undefined),
  mockGetMainWindow: vi.fn(() => ({
    webContents: {
      executeJavaScript: mockExecuteJavaScript
    }
  }))
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((_channel: string, handler: () => void) => {
      handler()
    })
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('../CacheService', () => ({
  CacheService: {
    remove: (...args: unknown[]) => mockCacheRemove(...args)
  }
}))

vi.mock('../WindowService', () => ({
  windowService: {
    getMainWindow: () => mockGetMainWindow()
  }
}))

import { invalidateApiServerProvidersCacheForAction, ReduxService, reduxService } from '../ReduxService'

async function makeService() {
  const svc = new ReduxService() as any
  svc.isReady = true
  return svc
}

function makeWebContents(state: Record<string, any>) {
  return {
    executeJavaScript: vi.fn().mockResolvedValue(state)
  }
}

describe('ReduxService.validateSelector', () => {
  const validate = (ReduxService as any).validateSelector.bind(ReduxService)

  it('accepts a simple top-level key', () => {
    expect(validate('settings')).toEqual(['settings'])
  })

  it('strips the "state." prefix', () => {
    expect(validate('state.settings')).toEqual(['settings'])
  })

  it('accepts a nested path without prefix', () => {
    expect(validate('llm.settings.vertexai')).toEqual(['llm', 'settings', 'vertexai'])
  })

  it('accepts a nested path with prefix', () => {
    expect(validate('state.llm.providers')).toEqual(['llm', 'providers'])
  })

  it('rejects selectors with parentheses', () => {
    expect(() => validate('state.settings()')).toThrow('Invalid selector')
  })

  it('rejects selectors with bracket access', () => {
    expect(() => validate('state.llm[0]')).toThrow('Invalid selector')
  })

  it('rejects selectors with operators', () => {
    expect(() => validate('state.settings || {}')).toThrow('Invalid selector')
  })

  it('rejects selectors with ternary expressions', () => {
    expect(() => validate('state.a ? state.b : state.c')).toThrow('Invalid selector')
  })

  it('rejects selectors starting with a digit', () => {
    expect(() => validate('1settings')).toThrow('Invalid selector')
  })

  it('rejects empty string', () => {
    expect(() => validate('')).toThrow('Invalid selector')
  })
})

describe('ReduxService.select', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a top-level path without state prefix', async () => {
    const state = { llm: { settings: { vertexai: { projectId: 'my-project' } } } }
    const wc = makeWebContents(state)
    mockGetMainWindow.mockReturnValue({ webContents: wc })

    const svc = await makeService()
    const result = await svc.select('llm.settings.vertexai')
    expect(result).toEqual({ projectId: 'my-project' })
  })

  it('resolves a path with state prefix', async () => {
    const state = { settings: { theme: 'dark' } }
    const wc = makeWebContents(state)
    mockGetMainWindow.mockReturnValue({ webContents: wc })

    const svc = await makeService()
    const result = await svc.select('state.settings')
    expect(result).toEqual({ theme: 'dark' })
  })

  it('returns undefined for a missing key rather than throwing', async () => {
    const state = { llm: {} }
    const wc = makeWebContents(state)
    mockGetMainWindow.mockReturnValue({ webContents: wc })

    const svc = await makeService()
    const result = await svc.select('llm.providers')
    expect(result).toBeUndefined()
  })

  it('returns undefined when an intermediate key is null', async () => {
    const state = { llm: null }
    const wc = makeWebContents(state)
    mockGetMainWindow.mockReturnValue({ webContents: wc })

    const svc = await makeService()
    const result = await svc.select('llm.settings')
    expect(result).toBeUndefined()
  })

  it('throws for an invalid selector expression', async () => {
    const wc = makeWebContents({})
    mockGetMainWindow.mockReturnValue({ webContents: wc })

    const svc = await makeService()
    await expect(svc.select('state.settings()')).rejects.toThrow('Invalid selector')
  })

  it('does not call executeJavaScript for invalid selectors', async () => {
    const wc = makeWebContents({})
    mockGetMainWindow.mockReturnValue({ webContents: wc })

    const svc = await makeService()
    await expect(svc.select('llm[0]')).rejects.toThrow('Invalid selector')
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })
})

describe('ReduxService provider cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMainWindow.mockReturnValue({
      webContents: {
        executeJavaScript: mockExecuteJavaScript
      }
    })
  })

  it('clears the API server provider cache for provider mutations', async () => {
    await reduxService.dispatch({ type: 'llm/updateProvider', payload: { id: 'openai', apiKey: 'new-key' } })

    expect(mockExecuteJavaScript).toHaveBeenCalled()
    expect(mockCacheRemove).toHaveBeenCalledWith('api-server:providers')
  })

  it('does not clear the API server provider cache for unrelated actions', () => {
    invalidateApiServerProvidersCacheForAction('llm/setDefaultModel')

    expect(mockCacheRemove).not.toHaveBeenCalled()
  })
})
