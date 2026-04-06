import { beforeEach, describe, expect, it, vi } from 'vitest'

type TestView = {
  state: {
    doc: object
    tr: {
      setMeta: ReturnType<typeof vi.fn>
    }
  }
  dispatch: ReturnType<typeof vi.fn>
  isDestroyed: boolean
}

function flushAsyncWork() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function createView(): TestView {
  const transaction = {
    setMeta: vi.fn().mockReturnThis()
  }

  return {
    state: {
      doc: {},
      tr: transaction
    },
    dispatch: vi.fn(),
    isDestroyed: false
  }
}

async function loadPlugin({
  blocks = [],
  getHighlighterImpl,
  loadLanguageIfNeededImpl,
  loadThemeIfNeededImpl
}: {
  blocks?: Array<any>
  getHighlighterImpl?: () => Promise<any>
  loadLanguageIfNeededImpl?: (...args: any[]) => Promise<any>
  loadThemeIfNeededImpl?: (...args: any[]) => Promise<any>
} = {}) {
  vi.resetModules()

  const findChildren = vi.fn(() => blocks)
  const getHighlighter = vi.fn(
    getHighlighterImpl ??
      (async () => ({
        getLoadedThemes: () => ['one-light'],
        getLoadedLanguages: () => [],
        codeToTokens: () => ({ tokens: [] })
      }))
  )
  const loadLanguageIfNeeded = vi.fn(loadLanguageIfNeededImpl ?? (async (_highlighter, language) => language))
  const loadThemeIfNeeded = vi.fn(loadThemeIfNeededImpl ?? (async (_highlighter, theme) => theme))

  vi.doMock('@tiptap/core', () => ({
    findChildren
  }))
  vi.doMock('@renderer/utils/shiki', () => ({
    getHighlighter,
    loadLanguageIfNeeded,
    loadThemeIfNeeded
  }))

  const { ShikiPlugin } = await import('./shikijsPlugin')

  return {
    ShikiPlugin,
    mocks: {
      findChildren,
      getHighlighter,
      loadLanguageIfNeeded,
      loadThemeIfNeeded
    }
  }
}

describe('ShikiPlugin lifecycle guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not dispatch after destroy while initDecorations is still pending', async () => {
    let resolveHighlighter: ((value: any) => void) | undefined
    const highlighterPromise = new Promise((resolve) => {
      resolveHighlighter = resolve
    })

    const { ShikiPlugin } = await loadPlugin({
      getHighlighterImpl: () => highlighterPromise
    })
    const plugin = ShikiPlugin({ name: 'codeBlock', defaultLanguage: 'text', theme: 'one-light' })
    const view = createView()
    const pluginView = (plugin as any).spec.view(view)

    pluginView.destroy()
    resolveHighlighter?.({
      getLoadedThemes: () => ['one-light'],
      getLoadedLanguages: () => [],
      codeToTokens: () => ({ tokens: [] })
    })

    await flushAsyncWork()

    expect(view.dispatch).not.toHaveBeenCalled()
  })

  it('does not dispatch after destroy while checkUndecoratedBlocks is still pending', async () => {
    let resolveLanguage: ((value: any) => void) | undefined
    const languagePromise = new Promise((resolve) => {
      resolveLanguage = resolve
    })

    const { ShikiPlugin, mocks } = await loadPlugin({
      blocks: [
        {
          pos: 1,
          node: {
            textContent: 'const value = 1',
            attrs: { language: 'ts' }
          }
        }
      ],
      loadLanguageIfNeededImpl: () => languagePromise
    })

    const plugin = ShikiPlugin({ name: 'codeBlock', defaultLanguage: 'text', theme: 'one-light' })
    const view = createView()
    const pluginView = (plugin as any).spec.view(view)

    await flushAsyncWork()
    view.dispatch.mockClear()

    pluginView.update()
    pluginView.destroy()
    resolveLanguage?.('ts')

    await flushAsyncWork()

    expect(mocks.loadLanguageIfNeeded).toHaveBeenCalledTimes(1)
    expect(view.dispatch).not.toHaveBeenCalled()
  })

  it('skips repeated refresh attempts for languages that fall back to plain text', async () => {
    const { ShikiPlugin, mocks } = await loadPlugin({
      blocks: [
        {
          pos: 1,
          node: {
            textContent: 'plain text',
            attrs: { language: 'custom-plain' }
          }
        }
      ],
      loadLanguageIfNeededImpl: async () => 'text'
    })

    const plugin = ShikiPlugin({ name: 'codeBlock', defaultLanguage: 'text', theme: 'one-light' })
    const view = createView()
    const pluginView = (plugin as any).spec.view(view)

    await flushAsyncWork()
    view.dispatch.mockClear()

    pluginView.update()
    await flushAsyncWork()
    pluginView.update()
    await flushAsyncWork()

    expect(mocks.loadLanguageIfNeeded).toHaveBeenCalledTimes(1)
    expect(view.dispatch).not.toHaveBeenCalled()
  })

  it('dispatches a single refresh when a new language is successfully loaded', async () => {
    const { ShikiPlugin, mocks } = await loadPlugin({
      blocks: [
        {
          pos: 1,
          node: {
            textContent: 'const value = 1',
            attrs: { language: 'ts' }
          }
        }
      ],
      loadLanguageIfNeededImpl: async () => 'ts'
    })

    const plugin = ShikiPlugin({ name: 'codeBlock', defaultLanguage: 'text', theme: 'one-light' })
    const view = createView()
    const pluginView = (plugin as any).spec.view(view)

    await flushAsyncWork()
    view.dispatch.mockClear()

    pluginView.update()
    await flushAsyncWork()

    expect(mocks.loadLanguageIfNeeded).toHaveBeenCalledTimes(1)
    expect(view.dispatch).toHaveBeenCalledTimes(1)
    expect(view.state.tr.setMeta).toHaveBeenCalledWith('shikiHighlighterReady', true)
  })
})
