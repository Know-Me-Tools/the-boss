/**
 * ArtifactCardsDesigner.test.tsx — TDD tests for "Edit with AI" entry point.
 *
 * Tests that:
 * - ReactArtifactsCard renders an "Edit with AI" button when hasContent.
 * - Clicking it sets isDesignerOpen=true so ArtifactDesigner becomes visible.
 * - HtmlArtifactsCard renders an "Edit with AI" button when hasContent.
 * - Clicking it opens the designer with the correct source.
 * - Buttons are disabled when source is empty.
 * - useArtifactLibrary mock confirms no real IPC is triggered.
 *
 * Strategy: ArtifactDesigner is mocked via vi.mock('../ArtifactDesigner') so
 * no real orchestrator, CodeEditor, or Splitter is rendered. We assert on
 * the mock's received props instead.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HtmlArtifactsCard from '../HtmlArtifactsCard'
import ReactArtifactsCard from '../ReactArtifactsCard'

// ---------------------------------------------------------------------------
// Hoisted mocks — must use vi.hoisted so they are available before imports.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  loadArtifactSettings: vi.fn(),
  parseArtifactDirectiveOverrides: vi.fn(() => ({})),
  buildHtmlArtifactPreviewDocument: vi.fn(() => '<!doctype html><html><body>html preview</body></html>'),
  buildReactArtifactPreviewDocument: vi.fn(() => '<!doctype html><html><body>react preview</body></html>'),
  getThemeCss: vi.fn(() => ''),
  useTheme: vi.fn(() => ({ theme: 'dark' })),
  extractHtmlTitle: vi.fn(() => 'Demo Page'),
  getFileNameFromHtmlTitle: vi.fn(() => 'demo-page'),
  // Popup spies
  htmlPopup: vi.fn(),
  artifactPopup: vi.fn(),
  // Designer spy — captures open state + props when mounted
  designerOpen: vi.fn(),
  // Library hook
  saveArtifact: vi.fn().mockResolvedValue({ id: 'art-001' }),
  reload: vi.fn().mockResolvedValue(undefined)
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

vi.mock('@renderer/hooks/useArtifactLibrary', () => ({
  useArtifactLibrary: () => ({
    artifacts: [],
    allArtifacts: [],
    loading: false,
    search: '',
    setSearch: vi.fn(),
    kind: 'all',
    setKind: vi.fn(),
    reload: mocks.reload,
    saveArtifact: mocks.saveArtifact,
    updateMetadata: vi.fn(),
    forkArtifact: vi.fn(),
    deleteArtifact: vi.fn()
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => {
      if (defaultValue) return defaultValue
      if (key === 'settings.artifacts.library.preview_loading') return 'Preparing artifact preview...'
      if (key === 'settings.artifacts.react_compiling') return 'Compiling React/TSX artifact...'
      if (key === 'settings.artifacts.designer.edit_with_ai') return 'Edit with AI'
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

vi.mock('../ArtifactDesigner', () => ({
  default: (props: { open: boolean; initialSource: string; language: string; onClose: () => void }) => {
    mocks.designerOpen(props)
    if (!props.open) return null
    return (
      <div data-testid="artifact-designer-mock">
        <span data-testid="designer-language">{props.language}</span>
        <span data-testid="designer-source">{props.initialSource}</span>
        <textarea aria-label="settings.artifacts.designer.prompt_label" />
        <button type="button" onClick={props.onClose}>
          close-designer
        </button>
      </div>
    )
  }
}))

// ---------------------------------------------------------------------------
// beforeEach setup
// ---------------------------------------------------------------------------

describe('artifact cards — Edit with AI entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.loadArtifactSettings.mockResolvedValue({
      baseCss: '',
      customCss: '',
      defaultThemeId: 'boss-light',
      defaultHtmlRuntimeProfileId: 'html',
      defaultReactRuntimeProfileId: 'react-default',
      accessPolicy: { internetEnabled: false, serviceIds: [], serviceToolIds: [] }
    })

    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
    })

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        artifacts: {
          compileReact: vi.fn().mockResolvedValue({ ok: true, script: 'compiled()', diagnostics: [], errors: [] }),
          save: vi.fn().mockResolvedValue({ id: 'art-001' }),
          list: vi.fn().mockResolvedValue([])
        },
        file: {
          createTempFile: vi.fn().mockResolvedValue('/tmp/preview.html'),
          write: vi.fn().mockResolvedValue(undefined),
          openPath: vi.fn().mockResolvedValue(undefined),
          save: vi.fn().mockResolvedValue(undefined)
        },
        shell: { openExternal: vi.fn() }
      }
    })

    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: { success: vi.fn(), error: vi.fn() }
    })
  })

  // -------------------------------------------------------------------------
  // ReactArtifactsCard — Edit with AI button renders when hasContent
  // -------------------------------------------------------------------------

  describe('ReactArtifactsCard', () => {
    it('renders an "Edit with AI" button when the card has content', () => {
      const source = 'export default function App() { return <div>Hello</div> }'
      render(<ReactArtifactsCard code={source} />)

      const btn = screen.getByRole('button', { name: /edit with ai/i })
      expect(btn).toBeInTheDocument()
      expect(btn).not.toBeDisabled()
    })

    it('renders an "Edit with AI" button that is disabled when source is empty', () => {
      render(<ReactArtifactsCard code="" />)

      const btn = screen.getByRole('button', { name: /edit with ai/i })
      expect(btn).toBeInTheDocument()
      expect(btn).toBeDisabled()
    })

    it('opens the ArtifactDesigner when "Edit with AI" is clicked', async () => {
      const source = 'export default function App() { return <div>Hello</div> }'
      render(<ReactArtifactsCard code={source} />)

      fireEvent.click(screen.getByRole('button', { name: /edit with ai/i }))

      await waitFor(() => {
        expect(screen.getByTestId('artifact-designer-mock')).toBeInTheDocument()
      })
    })

    it('passes the correct source and language to ArtifactDesigner', async () => {
      const source = 'export default function App() { return <div>Hi</div> }'
      render(<ReactArtifactsCard code={source} sourceLanguage="tsx" />)

      fireEvent.click(screen.getByRole('button', { name: /edit with ai/i }))

      await waitFor(() => {
        expect(screen.getByTestId('designer-source')).toHaveTextContent(source)
        expect(screen.getByTestId('designer-language')).toHaveTextContent('tsx')
      })
    })

    it('closes the ArtifactDesigner when onClose is called', async () => {
      const source = 'export default function App() { return <div>Close test</div> }'
      render(<ReactArtifactsCard code={source} />)

      fireEvent.click(screen.getByRole('button', { name: /edit with ai/i }))

      await waitFor(() => {
        expect(screen.getByTestId('artifact-designer-mock')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('close-designer'))

      await waitFor(() => {
        expect(screen.queryByTestId('artifact-designer-mock')).not.toBeInTheDocument()
      })
    })

    it('does not call useArtifactLibrary.saveArtifact during initial mount', () => {
      render(<ReactArtifactsCard code="export default function App() { return <div /> }" />)
      expect(mocks.saveArtifact).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // HtmlArtifactsCard — Edit with AI button renders when hasContent
  // -------------------------------------------------------------------------

  describe('HtmlArtifactsCard', () => {
    it('renders an "Edit with AI" button when the card has content', () => {
      render(<HtmlArtifactsCard html="<p>Hello HTML</p>" />)

      const btn = screen.getByRole('button', { name: /edit with ai/i })
      expect(btn).toBeInTheDocument()
      expect(btn).not.toBeDisabled()
    })

    it('renders an "Edit with AI" button that is disabled when source is empty', () => {
      render(<HtmlArtifactsCard html="" />)

      const btn = screen.getByRole('button', { name: /edit with ai/i })
      expect(btn).toBeInTheDocument()
      expect(btn).toBeDisabled()
    })

    it('opens the ArtifactDesigner when "Edit with AI" is clicked', async () => {
      render(<HtmlArtifactsCard html="<p>Design me</p>" />)

      fireEvent.click(screen.getByRole('button', { name: /edit with ai/i }))

      await waitFor(() => {
        expect(screen.getByTestId('artifact-designer-mock')).toBeInTheDocument()
      })
    })

    it('passes the correct source and language to ArtifactDesigner', async () => {
      const source = '<p>HTML source test</p>'
      render(<HtmlArtifactsCard html={source} />)

      fireEvent.click(screen.getByRole('button', { name: /edit with ai/i }))

      await waitFor(() => {
        expect(screen.getByTestId('designer-source')).toHaveTextContent(source)
        expect(screen.getByTestId('designer-language')).toHaveTextContent('html')
      })
    })

    it('closes the ArtifactDesigner when onClose is called', async () => {
      render(<HtmlArtifactsCard html="<p>Close test</p>" />)

      fireEvent.click(screen.getByRole('button', { name: /edit with ai/i }))

      await waitFor(() => {
        expect(screen.getByTestId('artifact-designer-mock')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('close-designer'))

      await waitFor(() => {
        expect(screen.queryByTestId('artifact-designer-mock')).not.toBeInTheDocument()
      })
    })

    it('does not call useArtifactLibrary.saveArtifact during initial mount', () => {
      render(<HtmlArtifactsCard html="<div>Static HTML</div>" />)
      expect(mocks.saveArtifact).not.toHaveBeenCalled()
    })
  })
})
