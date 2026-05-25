import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  warmupWorker: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn(),
  getHighlighter: vi.fn(),
  getShiki: vi.fn().mockResolvedValue({ bundledThemesInfo: [] })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({
    codeEditor: {
      enabled: false,
      themeLight: 'auto',
      themeDark: 'auto'
    },
    codeViewer: {
      themeLight: 'auto',
      themeDark: 'auto'
    }
  })
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/hooks/useMermaid', () => ({
  useMermaid: vi.fn()
}))

vi.mock('@renderer/utils/shiki', () => ({
  getHighlighter: mocks.getHighlighter,
  getMarkdownIt: vi.fn(),
  getShiki: mocks.getShiki,
  loadLanguageIfNeeded: vi.fn(),
  loadThemeIfNeeded: vi.fn()
}))

vi.mock('@renderer/services/ShikiStreamService', () => ({
  shikiStreamService: {
    warmupWorker: mocks.warmupWorker,
    dispose: mocks.dispose,
    highlightCodeChunk: vi.fn(),
    highlightStreamingCode: vi.fn(),
    cleanupTokenizers: vi.fn(),
    getShikiPreProperties: vi.fn()
  }
}))

import { CodeStyleProvider } from '../CodeStyleProvider'

describe('CodeStyleProvider', () => {
  it('warms up the Shiki worker on mount without initializing the main-thread highlighter', async () => {
    const { unmount } = render(
      <CodeStyleProvider>
        <div>child</div>
      </CodeStyleProvider>
    )

    await waitFor(() => expect(mocks.warmupWorker).toHaveBeenCalledTimes(1))

    expect(mocks.getHighlighter).not.toHaveBeenCalled()

    unmount()

    expect(mocks.dispose).toHaveBeenCalledTimes(1)
  })
})
