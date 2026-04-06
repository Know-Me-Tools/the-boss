import { beforeEach, describe, expect, it, vi } from 'vitest'

const render = vi.fn()
const createRoot = vi.fn(() => ({ render }))

vi.mock('react-dom/client', () => ({
  createRoot
}))

vi.mock('./App', () => ({
  default: () => null
}))

describe('entryPoint', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    render.mockClear()
    createRoot.mockClear()
    vi.resetModules()
  })

  it('initializes the logger window source before creating the React root', async () => {
    const { loggerService } = await import('@logger')
    const events: string[] = []

    const initSpy = vi.spyOn(loggerService, 'initWindowSource').mockImplementation(() => {
      events.push('initWindowSource')
      return loggerService
    })

    createRoot.mockImplementationOnce(() => {
      events.push('createRoot')
      return { render }
    })

    await import('./entryPoint')

    expect(initSpy).toHaveBeenCalledWith('mainWindow')
    expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'))
    expect(render).toHaveBeenCalledTimes(1)
    expect(events.indexOf('initWindowSource')).toBeLessThan(events.indexOf('createRoot'))
  })
})
