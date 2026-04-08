import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useImperativeHandle, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ArtifactPopup from '../ArtifactPopup'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/Icons', () => ({
  CopyIcon: () => <span data-testid="copy-icon" />,
  FilePngIcon: () => <span data-testid="file-png-icon" />
}))

vi.mock('@renderer/utils/image', () => ({
  captureScrollableIframeAsBlob: vi.fn(),
  captureScrollableIframeAsDataURL: vi.fn()
}))

vi.mock('@renderer/utils', () => ({
  classNames: (...values: Array<Record<string, boolean> | string | undefined>) =>
    values
      .flatMap((value) => {
        if (!value) {
          return []
        }

        if (typeof value === 'string') {
          return [value]
        }

        return Object.entries(value)
          .filter(([, enabled]) => enabled)
          .map(([name]) => name)
      })
      .join(' ')
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key
  }),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  }
}))

vi.mock('antd', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const Splitter = ({ children, onResize }: any) => (
    <div data-testid="splitter" data-resize={Boolean(onResize)}>
      {children}
    </div>
  )
  const Dropdown = ({ children }: any) => <>{children}</>

  Splitter.Panel = ({ children }: any) => <div data-testid="splitter-panel">{children}</div>
  Dropdown.Button = ({ children }: any) => <div data-testid="dropdown-button">{children}</div>

  return {
    ...actual,
    Alert: ({ message, onClose, closable }: any) => (
      <div data-testid="alert">
        <span>{message}</span>
        {closable && (
          <button type="button" onClick={onClose}>
            dismiss
          </button>
        )}
      </div>
    ),
    Button: ({ children, icon, onClick, disabled, ['aria-label']: ariaLabel, loading, type }: any) => (
      <button
        type="button"
        aria-label={ariaLabel}
        data-loading={loading}
        data-type={type}
        disabled={disabled}
        onClick={onClick}>
        {icon}
        {children}
      </button>
    ),
    Dropdown,
    Modal: ({ open, title, children }: any) =>
      open ? (
        <div data-testid="modal">
          <div>{title}</div>
          <div>{children}</div>
        </div>
      ) : null,
    Space: ({ children }: any) => <div data-testid="space">{children}</div>,
    Splitter,
    Tooltip: ({ children }: any) => <>{children}</>,
    Typography: {
      Text: ({ children }: any) => <span>{children}</span>
    }
  }
})

vi.mock('@renderer/components/CodeEditor', () => {
  const MockCodeEditor = ({ ref, value, onSave }) => {
    const [content, setContent] = useState(value)

    useImperativeHandle(
      ref,
      () => ({
        getContent: () => content,
        save: () => onSave?.(content)
      }),
      [content, onSave]
    )

    return (
      <textarea aria-label="artifact-editor" value={content} onChange={(event) => setContent(event.target.value)} />
    )
  }

  return {
    __esModule: true,
    default: MockCodeEditor
  }
})

describe('ArtifactPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        artifacts: {
          save: vi.fn().mockResolvedValue(undefined)
        },
        file: {
          saveImage: vi.fn()
        },
        services: {
          onSubscriptionEvent: vi.fn(() => vi.fn()),
          invokeOperation: vi.fn(),
          subscribe: vi.fn(),
          unsubscribe: vi.fn()
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

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
  })

  it('copies the current editor contents from the popup header action', async () => {
    render(
      <ArtifactPopup
        open={true}
        title="Artifact"
        code="initial source"
        codeLanguage="tsx"
        typeLabel="React/TSX Artifact"
        previewDocument="<!doctype html><html><body>preview</body></html>"
        onClose={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('artifact-editor'), {
      target: { value: 'edited source' }
    })

    fireEvent.click(screen.getByLabelText('code_block.copy.source'))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('edited source')
    })

    expect(window.toast.success).toHaveBeenCalledWith('code_block.copy.success')
  })

  it('shows an inline library save error and clears it on a successful retry', async () => {
    const createLibraryDraft = vi.fn(async (source: string) => ({
      title: 'Artifact',
      kind: 'react' as const,
      runtimeProfileId: 'react-default' as const,
      sourceLanguage: 'tsx' as const,
      source,
      themeId: 'boss-light' as const,
      accessPolicy: {
        internetEnabled: false,
        serviceIds: []
      }
    }))

    const saveMock = window.api.artifacts.save as unknown as ReturnType<typeof vi.fn>

    saveMock.mockRejectedValueOnce(new Error('Save exploded')).mockResolvedValueOnce({ id: 'artifact-1' })

    render(
      <ArtifactPopup
        open={true}
        title="Artifact"
        code="initial source"
        codeLanguage="tsx"
        typeLabel="React/TSX Artifact"
        previewDocument="<!doctype html><html><body>preview</body></html>"
        createLibraryDraft={createLibraryDraft}
        onClose={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('artifact-editor'), {
      target: { value: 'saved source' }
    })

    fireEvent.click(screen.getByLabelText('settings.artifacts.library.save_action'))

    await waitFor(() => {
      expect(screen.getByText('Save exploded')).toBeInTheDocument()
    })

    expect(window.toast.error).toHaveBeenCalledWith('Save exploded')
    expect(createLibraryDraft).toHaveBeenCalledWith('saved source')

    fireEvent.click(screen.getByLabelText('settings.artifacts.library.save_action'))

    await waitFor(() => {
      expect(window.toast.success).toHaveBeenCalledWith('settings.artifacts.library.save_success')
    })

    await waitFor(() => {
      expect(screen.queryByText('Save exploded')).not.toBeInTheDocument()
    })
  })
})
