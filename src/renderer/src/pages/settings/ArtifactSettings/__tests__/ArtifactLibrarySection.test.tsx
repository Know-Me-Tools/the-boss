import type { ArtifactRecord, ArtifactSettings } from '@shared/artifacts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ArtifactLibrarySection from '../ArtifactLibrarySection'

const mocks = vi.hoisted(() => ({
  artifacts: [] as ArtifactRecord[],
  buildHtmlArtifactPreviewDocument: vi.fn(() => '<!doctype html><html><body>html preview</body></html>'),
  buildReactArtifactPreviewDocument: vi.fn(() => '<!doctype html><html><body>react preview</body></html>'),
  getThemeCss: vi.fn(() => ''),
  parseArtifactDirectiveOverrides: vi.fn(() => ({})),
  popupOpen: vi.fn(),
  designerOpen: vi.fn(),
  updateSource: vi.fn(),
  saveArtifact: vi.fn(),
  updateMetadata: vi.fn(),
  forkArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  reload: vi.fn()
}))

vi.mock('@renderer/artifacts/config', () => ({
  buildHtmlArtifactPreviewDocument: mocks.buildHtmlArtifactPreviewDocument,
  buildReactArtifactPreviewDocument: mocks.buildReactArtifactPreviewDocument,
  getThemeCss: mocks.getThemeCss,
  parseArtifactDirectiveOverrides: mocks.parseArtifactDirectiveOverrides
}))

vi.mock('@renderer/hooks/useArtifactLibrary', () => ({
  useArtifactLibrary: () => ({
    artifacts: mocks.artifacts,
    allArtifacts: mocks.artifacts,
    loading: false,
    search: '',
    setSearch: vi.fn(),
    kind: 'all',
    setKind: vi.fn(),
    reload: mocks.reload,
    saveArtifact: mocks.saveArtifact,
    updateMetadata: mocks.updateMetadata,
    updateSource: mocks.updateSource,
    forkArtifact: mocks.forkArtifact,
    deleteArtifact: mocks.deleteArtifact
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string }) => {
      if (options?.defaultValue) return options.defaultValue
      if (key === 'settings.artifacts.designer.edit_with_ai') return 'Edit with AI'
      if (key === 'settings.artifacts.library.versions') return `${options?.count ?? 0} versions`
      if (key === 'common.open') return 'Open'
      if (key === 'common.copy') return 'Copy'
      if (key === 'common.rename') return 'Rename'
      if (key === 'common.delete') return 'Delete'
      return key
    }
  })
}))

vi.mock('@renderer/components/CodeBlockView/ArtifactPopup', () => ({
  default: (props: { open: boolean; title: string }) => {
    mocks.popupOpen(props)
    if (!props.open) return null
    return <div data-testid="artifact-popup-mock">{props.title}</div>
  }
}))

vi.mock('@renderer/components/CodeBlockView/ArtifactDesigner', () => ({
  default: (props: {
    open: boolean
    title: string
    initialSource: string
    language: string
    saveArtifact: (draft: { source: string }) => Promise<{ id: string }>
    onClose: () => void
  }) => {
    mocks.designerOpen(props)
    if (!props.open) return null
    return (
      <div data-testid="artifact-designer-mock">
        <span data-testid="designer-title">{props.title}</span>
        <span data-testid="designer-source">{props.initialSource}</span>
        <span data-testid="designer-language">{props.language}</span>
        <button type="button" onClick={() => void props.saveArtifact({ source: '<main>Updated</main>' })}>
          save-designer
        </button>
        <button type="button" onClick={props.onClose}>
          close-designer
        </button>
      </div>
    )
  }
}))

function makeArtifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  const timestamp = '2026-06-03T00:00:00.000Z'
  const source = overrides.latestSource ?? '<main>Hello</main>'

  return {
    id: 'artifact-html',
    title: 'Stored HTML',
    kind: 'html',
    runtimeProfileId: 'html+htmx',
    sourceLanguage: 'html',
    latestSource: source,
    themeId: 'boss-dark',
    accessPolicy: {
      internetEnabled: false,
      serviceIds: ['svc-1'],
      serviceToolIds: ['tool-1']
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    currentVersionId: 'version-1',
    versions: [
      {
        id: 'version-1',
        createdAt: timestamp,
        source,
        sourceLanguage: 'html',
        runtimeProfileId: 'html+htmx',
        themeId: 'boss-dark',
        accessPolicy: {
          internetEnabled: false,
          serviceIds: ['svc-1'],
          serviceToolIds: ['tool-1']
        }
      }
    ],
    origin: {
      messageBlockId: 'message-1',
      codeBlockId: 'code-1'
    },
    exportMetadata: {
      status: 'not-exported',
      schemaVersion: 'a2ui-draft'
    },
    ...overrides
  }
}

const settings: ArtifactSettings = {
  defaultHtmlRuntimeProfileId: 'html',
  defaultReactRuntimeProfileId: 'react-default',
  defaultThemeId: 'boss-light',
  accessPolicy: {
    internetEnabled: true,
    serviceIds: [],
    serviceToolIds: []
  },
  exposePackageRegistry: true,
  baseCss: '',
  customCss: ''
}

describe('ArtifactLibrarySection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.artifacts = []
    mocks.updateSource.mockResolvedValue(makeArtifact({ id: 'artifact-html', latestSource: '<main>Updated</main>' }))

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        artifacts: {
          compileReact: vi.fn().mockResolvedValue({ ok: true, script: 'compiled()', diagnostics: [] })
        }
      }
    })

    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        success: vi.fn(),
        error: vi.fn()
      }
    })

    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
  })

  it('opens stored HTML artifacts in ArtifactDesigner from the library', async () => {
    const artifact = makeArtifact()
    mocks.artifacts = [artifact]

    render(<ArtifactLibrarySection theme="dark" settings={settings} />)

    fireEvent.click(screen.getByRole('button', { name: /edit with ai/i }))

    await waitFor(() => {
      expect(screen.getByTestId('artifact-designer-mock')).toBeInTheDocument()
    })

    expect(screen.getByTestId('designer-title')).toHaveTextContent('Stored HTML')
    expect(screen.getByTestId('designer-source')).toHaveTextContent('<main>Hello</main>')
    expect(screen.getByTestId('designer-language')).toHaveTextContent('html')
  })

  it('opens stored React artifacts with the stored source language', async () => {
    mocks.artifacts = [
      makeArtifact({
        id: 'artifact-react',
        title: 'Stored React',
        kind: 'react',
        runtimeProfileId: 'react-default',
        sourceLanguage: 'tsx',
        latestSource: 'export default function App() { return <div>Hello</div> }',
        currentVersionId: 'react-version-1',
        versions: [
          {
            id: 'react-version-1',
            createdAt: '2026-06-03T00:00:00.000Z',
            source: 'export default function App() { return <div>Hello</div> }',
            sourceLanguage: 'tsx',
            runtimeProfileId: 'react-default',
            themeId: 'boss-dark',
            accessPolicy: {
              internetEnabled: false,
              serviceIds: ['svc-1'],
              serviceToolIds: ['tool-1']
            }
          }
        ]
      })
    ]

    render(<ArtifactLibrarySection theme="dark" settings={settings} />)

    fireEvent.click(screen.getByRole('button', { name: /edit with ai/i }))

    await waitFor(() => {
      expect(screen.getByTestId('artifact-designer-mock')).toBeInTheDocument()
    })

    expect(screen.getByTestId('designer-title')).toHaveTextContent('Stored React')
    expect(screen.getByTestId('designer-language')).toHaveTextContent('tsx')
  })

  it('saves stored designer refinements through updateSource instead of saveArtifact', async () => {
    const artifact = makeArtifact()
    mocks.artifacts = [artifact]

    render(<ArtifactLibrarySection theme="dark" settings={settings} />)

    fireEvent.click(screen.getByRole('button', { name: /edit with ai/i }))
    fireEvent.click(await screen.findByText('save-designer'))

    await waitFor(() => {
      expect(mocks.updateSource).toHaveBeenCalledWith({
        id: artifact.id,
        source: '<main>Updated</main>',
        sourceLanguage: artifact.sourceLanguage,
        runtimeProfileId: artifact.runtimeProfileId,
        themeId: artifact.themeId,
        accessPolicy: artifact.accessPolicy,
        origin: artifact.origin
      })
    })

    expect(mocks.saveArtifact).not.toHaveBeenCalled()
  })

  it('keeps the Open preview action on ArtifactPopup', async () => {
    mocks.artifacts = [makeArtifact()]

    render(<ArtifactLibrarySection theme="dark" settings={settings} />)

    fireEvent.click(screen.getByRole('button', { name: /^open$/i }))

    await waitFor(() => {
      expect(screen.getByTestId('artifact-popup-mock')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('artifact-designer-mock')).not.toBeInTheDocument()
  })
})
