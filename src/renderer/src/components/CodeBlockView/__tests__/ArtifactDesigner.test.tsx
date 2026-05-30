/**
 * ArtifactDesigner.test.tsx — TDD test suite for the 3-pane artifact designer.
 *
 * Strategy:
 * - The `runTurn` prop is always injected as a mock; real orchestrator is never imported.
 * - `buildPreviewDocument` is a spy so we can assert it was called with the right source.
 * - Mock setup mirrors ArtifactPopup.test.tsx for consistency.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ArtifactDesignEvent, ArtifactSourceLanguage } from '../../../artifacts/designProtocol'
import type { EditorState } from '../../../artifacts/editorReducer'
import { initEditorState } from '../../../artifacts/editorReducer'
import ArtifactDesigner from '../ArtifactDesigner'

// ---------------------------------------------------------------------------
// Type alias for the runTurn mock — avoids TS2558 with the two-argument
// generic form vi.fn<[Args], Return>() which current Vitest types reject.
// ---------------------------------------------------------------------------

type RunTurnMock = (args: {
  state: EditorState
  request: string
  language: ArtifactSourceLanguage
  turnId: string
  title?: string
}) => Promise<{ events: ArtifactDesignEvent[]; state: EditorState }>

// ---------------------------------------------------------------------------
// Module mocks — same pattern as ArtifactPopup.test.tsx
// ---------------------------------------------------------------------------

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
  const Splitter = ({ children }: { children: React.ReactNode }) => <div data-testid="splitter">{children}</div>
  Splitter.Panel = ({ children }: { children: React.ReactNode }) => <div data-testid="splitter-panel">{children}</div>

  return {
    ...actual,
    Alert: ({ message }: { message: string }) => (
      <div data-testid="alert">
        <span>{message}</span>
      </div>
    ),
    Button: ({
      children,
      onClick,
      disabled,
      loading,
      'aria-label': ariaLabel,
      type: _type,
      ...rest
    }: {
      children?: React.ReactNode
      onClick?: () => void
      disabled?: boolean
      loading?: boolean
      'aria-label'?: string
      type?: string
      [key: string]: unknown
    }) => (
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={disabled || loading}
        onClick={onClick}
        {...(rest as Record<string, unknown>)}>
        {children}
      </button>
    ),
    Splitter,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
  }
})

vi.mock('@renderer/components/CodeEditor', () => {
  const MockCodeEditor = ({
    value,
    'aria-label': ariaLabel
  }: {
    value?: string
    'aria-label'?: string
    [key: string]: unknown
  }) => {
    const [content, setContent] = useState(value ?? '')
    return (
      <textarea aria-label={ariaLabel ?? 'code-editor'} value={content} onChange={(e) => setContent(e.target.value)} />
    )
  }

  return {
    __esModule: true,
    default: MockCodeEditor
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePreviewState(source: string): EditorState {
  return {
    ...initEditorState({ source, language: 'html' }),
    phase: 'preview',
    lastBuild: { ok: true, diagnostics: [], errors: [] },
    activeTurnId: null
  }
}

function makeRepairState(source: string, diagnostics: string[]): EditorState {
  return {
    ...initEditorState({ source, language: 'html' }),
    phase: 'repair',
    lastBuild: { ok: false, diagnostics, errors: [] },
    activeTurnId: null
  }
}

function makeErrorState(message: string): EditorState {
  return {
    ...initEditorState(),
    phase: 'error',
    error: message,
    activeTurnId: null
  }
}

const defaultProps = {
  open: true,
  title: 'Test Artifact',
  initialSource: '<p>Hello</p>',
  language: 'html' as ArtifactSourceLanguage,
  typeLabel: 'HTML Artifact',
  buildPreviewDocument: vi.fn((source: string) => `<html><body>${source}</body></html>`),
  onClose: vi.fn(),
  generateTurnId: () => 'test-turn-1'
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ArtifactDesigner', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        artifacts: {
          save: vi.fn().mockResolvedValue(undefined),
          compileReact: vi.fn().mockResolvedValue({ script: '', ok: true, diagnostics: [], errors: [] })
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
  })

  // -------------------------------------------------------------------------
  // 1. Renders 3 panes + prompt input + send button
  // -------------------------------------------------------------------------

  it('renders the chat pane, code pane, preview pane, prompt input, and send button', () => {
    const runTurn: RunTurnMock = vi.fn()
    render(<ArtifactDesigner {...defaultProps} runTurn={runTurn} />)

    // Chat transcript region
    expect(screen.getByRole('log')).toBeInTheDocument()

    // Prompt input accessible by label
    const promptInput = screen.getByRole('textbox', { name: /artifacts.designer.prompt/i })
    expect(promptInput).toBeInTheDocument()

    // Send button accessible by name
    const sendButton = screen.getByRole('button', { name: /artifacts.designer.send/i })
    expect(sendButton).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // 2. Submitting a request calls runTurn; preview updates on build-ok
  // -------------------------------------------------------------------------

  it('calls runTurn with correct args and updates preview when build succeeds', async () => {
    const newSource = '<p>Updated content</p>'
    // No ': RunTurnMock' annotation here so TypeScript retains the MockInstance type
    // (needed to access .mock.calls below).
    const runTurn = vi.fn<RunTurnMock>().mockResolvedValue({
      events: [],
      state: makePreviewState(newSource)
    })

    const buildPreviewDocument = vi.fn((source: string) => `<html><body>${source}</body></html>`)

    render(
      <ArtifactDesigner
        {...defaultProps}
        runTurn={runTurn}
        buildPreviewDocument={buildPreviewDocument}
        generateTurnId={() => 'test-turn-1'}
      />
    )

    const promptInput = screen.getByRole('textbox', { name: /artifacts.designer.prompt/i })
    const sendButton = screen.getByRole('button', { name: /artifacts.designer.send/i })

    fireEvent.change(promptInput, { target: { value: 'Make it blue' } })
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect(runTurn).toHaveBeenCalledOnce()
    })

    const callArgs = runTurn.mock.calls[0][0]
    expect(callArgs.request).toBe('Make it blue')
    expect(callArgs.language).toBe('html')
    expect(callArgs.turnId).toBe('test-turn-1')
    expect(callArgs.state).toBeDefined()

    // After resolution, buildPreviewDocument should have been called with new source
    await waitFor(() => {
      expect(buildPreviewDocument).toHaveBeenCalledWith(newSource)
    })

    // Preview iframe should be rendered (phase = preview)
    await waitFor(() => {
      const iframe = screen.getByTitle(/artifacts.designer.preview.title/i)
      expect(iframe).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // 3. Build-failure path: diagnostics shown, no preview
  // -------------------------------------------------------------------------

  it('shows build diagnostics in chat pane and hides preview when build fails', async () => {
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makeRepairState('<p>broken</p>', ['TS2322: Type mismatch'])
    })

    render(<ArtifactDesigner {...defaultProps} runTurn={runTurn} />)

    const promptInput = screen.getByRole('textbox', { name: /artifacts.designer.prompt/i })
    fireEvent.change(promptInput, { target: { value: 'Fix the types' } })
    fireEvent.click(screen.getByRole('button', { name: /artifacts.designer.send/i }))

    await waitFor(() => {
      // Text appears in the transcript AND the assertive alert region — use getAllByText.
      expect(screen.getAllByText('TS2322: Type mismatch').length).toBeGreaterThan(0)
    })

    // No preview iframe should be visible
    expect(screen.queryByTitle(/artifacts.designer.preview.title/i)).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // 4. Error path: error message shown
  // -------------------------------------------------------------------------

  it('shows error message when runTurn returns error phase', async () => {
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makeErrorState('Model call failed: timeout')
    })

    render(<ArtifactDesigner {...defaultProps} runTurn={runTurn} />)

    const promptInput = screen.getByRole('textbox', { name: /artifacts.designer.prompt/i })
    fireEvent.change(promptInput, { target: { value: 'Do something' } })
    fireEvent.click(screen.getByRole('button', { name: /artifacts.designer.send/i }))

    await waitFor(() => {
      // Text appears in both the transcript and the assertive alert region.
      expect(screen.getAllByText('Model call failed: timeout').length).toBeGreaterThan(0)
    })
  })

  // -------------------------------------------------------------------------
  // 5. Input disabled while turn is in flight
  // -------------------------------------------------------------------------

  it('disables prompt input while a turn is in flight, re-enables on completion', async () => {
    let resolveRun!: (value: { events: ArtifactDesignEvent[]; state: EditorState }) => void
    const deferredPromise = new Promise<{ events: ArtifactDesignEvent[]; state: EditorState }>((resolve) => {
      resolveRun = resolve
    })

    const runTurn: RunTurnMock = vi.fn().mockReturnValue(deferredPromise)

    render(<ArtifactDesigner {...defaultProps} runTurn={runTurn} />)

    const promptInput = screen.getByRole('textbox', { name: /artifacts.designer.prompt/i })
    const sendButton = screen.getByRole('button', { name: /artifacts.designer.send/i })

    fireEvent.change(promptInput, { target: { value: 'Do something' } })
    fireEvent.click(sendButton)

    // Input should be disabled while in-flight
    await waitFor(() => {
      expect(promptInput).toBeDisabled()
    })
    // Send button is also disabled while in-flight
    expect(sendButton).toBeDisabled()

    // Resolve the deferred promise
    await act(async () => {
      resolveRun({ events: [], state: makePreviewState('<p>done</p>') })
    })

    // Input re-enabled after completion
    await waitFor(() => {
      expect(promptInput).not.toBeDisabled()
    })

    // Send button re-enabled when we type new text (it was empty after send cleared it)
    fireEvent.change(promptInput, { target: { value: 'Next request' } })
    expect(sendButton).not.toBeDisabled()
  })

  // -------------------------------------------------------------------------
  // 6. a11y: prompt input accessible by name; transcript has role="log"
  // -------------------------------------------------------------------------

  it('has accessible prompt input and aria-live transcript region', () => {
    const runTurn: RunTurnMock = vi.fn()
    render(<ArtifactDesigner {...defaultProps} runTurn={runTurn} />)

    // Prompt input reachable by accessible name
    const promptInput = screen.getByRole('textbox', { name: /artifacts.designer.prompt/i })
    expect(promptInput).toBeInTheDocument()

    // Transcript region with role="log" and aria-live
    const transcript = screen.getByRole('log')
    expect(transcript).toBeInTheDocument()
    expect(transcript).toHaveAttribute('aria-live', 'polite')
  })

  // -------------------------------------------------------------------------
  // 7. Save button calls onSaveToLibrary with current source
  // -------------------------------------------------------------------------

  it('calls onSaveToLibrary with current source when save button is clicked after build succeeds', async () => {
    const newSource = '<p>Saved content</p>'
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makePreviewState(newSource)
    })
    const onSaveToLibrary = vi.fn().mockResolvedValue(undefined)

    render(<ArtifactDesigner {...defaultProps} runTurn={runTurn} onSaveToLibrary={onSaveToLibrary} />)

    // Send a request to get to preview state
    const promptInput = screen.getByRole('textbox', { name: /artifacts.designer.prompt/i })
    fireEvent.change(promptInput, { target: { value: 'Make something' } })
    fireEvent.click(screen.getByRole('button', { name: /artifacts.designer.send/i }))

    await waitFor(() => {
      const saveButton = screen.getByRole('button', { name: /artifacts.designer.save/i })
      expect(saveButton).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /artifacts.designer.save/i }))

    await waitFor(() => {
      expect(onSaveToLibrary).toHaveBeenCalledWith(newSource)
    })
  })

  // -------------------------------------------------------------------------
  // 8. Preview iframe has a title attribute (a11y)
  // -------------------------------------------------------------------------

  it('renders preview iframe with a title when phase is preview', async () => {
    const newSource = '<p>Preview content</p>'
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makePreviewState(newSource)
    })

    render(<ArtifactDesigner {...defaultProps} runTurn={runTurn} />)

    fireEvent.change(screen.getByRole('textbox', { name: /artifacts.designer.prompt/i }), {
      target: { value: 'Build it' }
    })
    fireEvent.click(screen.getByRole('button', { name: /artifacts.designer.send/i }))

    await waitFor(() => {
      const iframe = screen.getByTitle(/artifacts.designer.preview.title/i)
      expect(iframe).toHaveAttribute('title')
      expect(iframe.tagName).toBe('IFRAME')
    })
  })

  // -------------------------------------------------------------------------
  // 9. Closed designer renders nothing
  // -------------------------------------------------------------------------

  it('renders nothing when open=false', () => {
    const runTurn: RunTurnMock = vi.fn()
    render(<ArtifactDesigner {...defaultProps} open={false} runTurn={runTurn} />)
    expect(screen.queryByRole('log')).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // 10. Ctrl+Enter / Cmd+Enter in the prompt textarea submits the turn
  // -------------------------------------------------------------------------

  it('submits the turn when Ctrl+Enter is pressed in the prompt textarea', async () => {
    // No ': RunTurnMock' annotation so TypeScript retains MockInstance for .mock.calls.
    const runTurn = vi.fn<RunTurnMock>().mockResolvedValue({
      events: [],
      state: makePreviewState('<p>via keyboard</p>')
    })

    render(<ArtifactDesigner {...defaultProps} runTurn={runTurn} />)

    const promptInput = screen.getByRole('textbox', { name: /artifacts.designer.prompt/i })
    fireEvent.change(promptInput, { target: { value: 'Build via keyboard' } })

    // Simulate Ctrl+Enter
    fireEvent.keyDown(promptInput, { key: 'Enter', ctrlKey: true })

    await waitFor(() => {
      expect(runTurn).toHaveBeenCalledOnce()
    })

    const callArgs = runTurn.mock.calls[0][0]
    expect(callArgs.request).toBe('Build via keyboard')
  })

  // -------------------------------------------------------------------------
  // 11. Double-submit prevention: second click while in-flight is a no-op
  // -------------------------------------------------------------------------

  it('does not call runTurn a second time when send is clicked while a turn is in flight', async () => {
    // First call returns a promise that never resolves so the component stays
    // in the in-flight state for the duration of this test.
    const runTurn: RunTurnMock = vi.fn().mockReturnValue(new Promise(() => {}))

    render(<ArtifactDesigner {...defaultProps} runTurn={runTurn} />)

    const promptInput = screen.getByRole('textbox', { name: /artifacts.designer.prompt/i })
    const sendButton = screen.getByRole('button', { name: /artifacts.designer.send/i })

    fireEvent.change(promptInput, { target: { value: 'First request' } })
    fireEvent.click(sendButton)

    // Wait for in-flight state to be set (button disabled)
    await waitFor(() => {
      expect(sendButton).toBeDisabled()
    })

    // The button is disabled so a direct click should be a no-op in the DOM,
    // but also fire the event to verify the guard in handleSend.
    fireEvent.click(sendButton)

    // runTurn must have been called exactly once
    expect(runTurn).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------------
  // 12. Assertive alert region shows error text when phase is 'error'
  // -------------------------------------------------------------------------

  it('populates the assertive alert region with the error message when runTurn returns error phase', async () => {
    const errorMessage = 'Model call failed: timeout'
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makeErrorState(errorMessage)
    })

    render(<ArtifactDesigner {...defaultProps} runTurn={runTurn} />)

    const promptInput = screen.getByRole('textbox', { name: /artifacts.designer.prompt/i })
    fireEvent.change(promptInput, { target: { value: 'Trigger error' } })
    fireEvent.click(screen.getByRole('button', { name: /artifacts.designer.send/i }))

    // The assertive alert region (role="alert") should contain the error text.
    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(errorMessage)
    })
  })
})
