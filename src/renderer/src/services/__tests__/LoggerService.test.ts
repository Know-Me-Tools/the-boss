import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('LoggerService window source inference', () => {
  const originalPath = window.location.pathname

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    window.history.replaceState({}, '', originalPath || '/')
    vi.restoreAllMocks()
  })

  it('infers the main window source from the default renderer entry', async () => {
    window.history.replaceState({}, '', '/')

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { loggerService } = await import('@renderer/services/LoggerService')

    loggerService.withContext('Test').info('hello')

    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      '[LoggerService] window source not initialized, please initialize window source first'
    )
  })

  it('infers trace window source from the trace entry html', async () => {
    window.history.replaceState({}, '', '/traceWindow.html')

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { loggerService } = await import('@renderer/services/LoggerService')

    loggerService.withContext('TraceTest').info('hello')

    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      '[LoggerService] window source not initialized, please initialize window source first'
    )
  })
})
