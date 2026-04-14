import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetMainWindow, mockIpcMainHandle } = vi.hoisted(() => ({
  mockGetMainWindow: vi.fn(),
  mockIpcMainHandle: vi.fn()
}))

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: mockGetMainWindow
  }
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

// Dynamically import after mocks are set up
async function makeService() {
  const { ReduxService } = await import('../ReduxService')
  const svc = new ReduxService() as any
  // Mark store as ready immediately so select() doesn't time out
  svc.isReady = true
  return svc
}

function makeWebContents(state: Record<string, any>) {
  return {
    executeJavaScript: vi.fn().mockResolvedValue(state)
  }
}

describe('ReduxService.validateSelector', async () => {
  const { ReduxService } = await import('../ReduxService')
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
    vi.resetModules()
  })

  it('resolves a top-level path (no state. prefix)', async () => {
    const state = { llm: { settings: { vertexai: { projectId: 'my-project' } } } }
    const wc = makeWebContents(state)
    mockGetMainWindow.mockReturnValue({ webContents: wc })

    const svc = await makeService()
    const result = await svc.select('llm.settings.vertexai')
    expect(result).toEqual({ projectId: 'my-project' })
  })

  it('resolves a path with state. prefix', async () => {
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
    // executeJavaScript should not have been called since validation fails first
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })
})
