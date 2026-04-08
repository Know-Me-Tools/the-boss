import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HtmlArtifactsCard from '../HtmlArtifactsCard'
import ReactArtifactsCard from '../ReactArtifactsCard'

function getButtonByText(text: string): HTMLButtonElement {
  const target = screen.getByText(text)
  const button = target.closest('button')

  if (!button) {
    throw new Error(`Unable to find button for text: ${text}`)
  }

  return button
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

const mocks = vi.hoisted(() => ({
  loadArtifactSettings: vi.fn(),
  parseArtifactDirectiveOverrides: vi.fn(() => ({})),
  buildHtmlArtifactPreviewDocument: vi.fn(() => '<!doctype html><html><body>wrapped html preview</body></html>'),
  buildReactArtifactPreviewDocument: vi.fn(() => '<!doctype html><html><body>wrapped react preview</body></html>'),
  getThemeCss: vi.fn(() => ''),
  useTheme: vi.fn(() => ({ theme: 'dark' })),
  extractHtmlTitle: vi.fn(() => 'Demo Artifact'),
  getFileNameFromHtmlTitle: vi.fn(() => 'demo-artifact'),
  htmlPopup: vi.fn(),
  artifactPopup: vi.fn()
}))

vi.mock('@renderer/artifacts/config', () => ({
  loadArtifactSettings: mocks.loadArtifactSettings,
  parseArtifactDirectiveOverrides: mocks.parseArtifactDirectiveOverrides,
  buildHtmlArtifactPreviewDocument: mocks.buildHtmlArtifactPreviewDocument,
  buildReactArtifactPreviewDocument: mocks.buildReactArtifactPreviewDocument,
  getThemeCss: mocks.getThemeCss
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => mocks.useTheme()
}))

vi.mock('@renderer/utils/formats', () => ({
  extractHtmlTitle: mocks.extractHtmlTitle,
  getFileNameFromHtmlTitle: mocks.getFileNameFromHtmlTitle
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => {
      if (defaultValue) {
        return defaultValue
      }

      if (key === 'settings.artifacts.library.preview_loading') {
        return 'Preparing artifact preview...'
      }

      if (key === 'settings.artifacts.react_compiling') {
        return 'Compiling React/TSX artifact...'
      }

      return key
    }
  })
}))

vi.mock('../HtmlArtifactsPopup', () => ({
  default: (props: { previewDocument: string }) => {
    mocks.htmlPopup(props)
    return <pre data-testid="html-artifact-popup-preview">{props.previewDocument}</pre>
  }
}))

vi.mock('../ArtifactPopup', () => ({
  default: (props: { previewDocument: string }) => {
    mocks.artifactPopup(props)
    return <pre data-testid="react-artifact-popup-preview">{props.previewDocument}</pre>
  }
}))

describe('artifact cards', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        artifacts: {
          compileReact: vi.fn().mockResolvedValue({
            ok: true,
            script: 'compiledReactArtifact()',
            diagnostics: []
          })
        },
        file: {
          createTempFile: vi.fn().mockResolvedValue('/tmp/artifact-preview.html'),
          write: vi.fn().mockResolvedValue(undefined),
          save: vi.fn().mockResolvedValue(undefined)
        },
        shell: {
          openExternal: vi.fn()
        }
      }
    })
  })

  it('keeps HTML artifact previews on a loading document until the wrapped preview is ready', async () => {
    const deferred = createDeferred<{
      baseCss: string
      customCss: string
      defaultThemeId: 'boss-light'
      defaultHtmlRuntimeProfileId: 'html'
      defaultReactRuntimeProfileId: 'react-default'
      accessPolicy: {
        internetEnabled: boolean
        serviceIds: string[]
      }
    }>()

    mocks.loadArtifactSettings.mockReturnValue(deferred.promise)

    const htmlSource = '<div x-data="logosApp()"></div>'
    render(<HtmlArtifactsCard html={htmlSource} runtimeProfileId="html+htmx+alpine" />)

    expect(screen.getByTestId('html-artifact-popup-preview').textContent).toContain('Preparing artifact preview...')
    expect(screen.getByTestId('html-artifact-popup-preview').textContent).not.toContain(htmlSource)

    deferred.resolve({
      baseCss: 'body { color: red; }',
      customCss: '',
      defaultThemeId: 'boss-light',
      defaultHtmlRuntimeProfileId: 'html',
      defaultReactRuntimeProfileId: 'react-default',
      accessPolicy: {
        internetEnabled: false,
        serviceIds: []
      }
    })

    await waitFor(() => {
      expect(screen.getByTestId('html-artifact-popup-preview').textContent).toContain('wrapped html preview')
    })

    expect(mocks.buildHtmlArtifactPreviewDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        source: htmlSource,
        runtimeProfileId: 'html+htmx+alpine',
        title: 'Demo Artifact'
      })
    )
  })

  it('keeps React artifact previews on a wrapped compile path instead of raw TSX source', async () => {
    mocks.loadArtifactSettings.mockResolvedValue({
      baseCss: 'body { color: red; }',
      customCss: '',
      defaultThemeId: 'boss-light',
      defaultHtmlRuntimeProfileId: 'html',
      defaultReactRuntimeProfileId: 'react-default',
      accessPolicy: {
        internetEnabled: false,
        serviceIds: []
      }
    })

    const reactSource = 'export default function App() { return <div>Hello</div> }'
    render(<ReactArtifactsCard code={reactSource} runtimeProfileId="react-default" sourceLanguage="tsx" />)

    expect(screen.getByTestId('react-artifact-popup-preview').textContent).toContain('Compiling React/TSX artifact...')
    expect(screen.getByTestId('react-artifact-popup-preview').textContent).not.toContain(reactSource)

    fireEvent.click(getButtonByText('chat.artifacts.button.preview'))

    await waitFor(() => {
      expect(window.api.artifacts.compileReact).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(screen.getByTestId('react-artifact-popup-preview').textContent).toContain('wrapped react preview')
    })

    expect(mocks.buildReactArtifactPreviewDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'App',
        script: 'compiledReactArtifact()'
      })
    )
  })
})
