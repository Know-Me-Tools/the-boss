/**
 * ArtifactDesigner.loop.test.tsx — Integration tests for change-006:
 * build-in-the-loop end-to-end wiring and library persistence.
 *
 * All external seams (runTurn, saveArtifact) are injected mocks.
 * No real orchestrator, IPC, or library calls are made.
 *
 * Decision record — artifact_saved vs direct state update:
 * The editorReducer.handleArtifactSaved guard checks
 * `event.turnId !== state.activeTurnId` and silently drops mismatched events.
 * After design_run_complete, activeTurnId is null. Any dispatched artifact_saved
 * event would fail the guard (turnId !== null) and be dropped. Therefore the
 * component sets savedRecordId directly via setEditorState after saveArtifact
 * resolves — library persistence is a post-turn, component-level concern that
 * cannot go through the reducer's turn-scoped artifact_saved path.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ArtifactRecordDraft } from '@shared/artifacts'
import type { ArtifactDesignEvent, ArtifactSourceLanguage } from '../../../artifacts/designProtocol'
import type { EditorState } from '../../../artifacts/editorReducer'
import { initEditorState } from '../../../artifacts/editorReducer'
import ArtifactDesigner from '../ArtifactDesigner'

// ---------------------------------------------------------------------------
// Type aliases for injected seams — keeps the test signatures explicit.
// ---------------------------------------------------------------------------

type RunTurnMock = (args: {
  state: EditorState
  request: string
  language: ArtifactSourceLanguage
  turnId: string
  title?: string
}) => Promise<{ events: ArtifactDesignEvent[]; state: EditorState }>

type SaveArtifactMock = (draft: ArtifactRecordDraft) => Promise<{ id: string }>

// ---------------------------------------------------------------------------
// Module mocks — identical pattern to ArtifactDesigner.test.tsx
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
  }) => <textarea aria-label={ariaLabel ?? 'code-editor'} value={value ?? ''} readOnly />

  return {
    __esModule: true,
    default: MockCodeEditor
  }
})

// ---------------------------------------------------------------------------
// State builders
// ---------------------------------------------------------------------------

function makePreviewState(source: string, language: ArtifactSourceLanguage = 'html'): EditorState {
  return {
    ...initEditorState({ source, language }),
    phase: 'preview',
    lastBuild: { ok: true, diagnostics: [], errors: [] },
    activeTurnId: null
  }
}

function makeRepairState(
  source: string,
  diagnostics: string[],
  language: ArtifactSourceLanguage = 'html'
): EditorState {
  return {
    ...initEditorState({ source, language }),
    phase: 'repair',
    lastBuild: { ok: false, diagnostics, errors: [] },
    activeTurnId: null
  }
}

// ---------------------------------------------------------------------------
// Default props factory — overrides welcome.
// ---------------------------------------------------------------------------

const HTML_SOURCE = '<h1>Hello</h1>'

function makeProps(overrides: Partial<Parameters<typeof ArtifactDesigner>[0]> = {}) {
  return {
    open: true,
    title: 'Test Artifact',
    initialSource: HTML_SOURCE,
    language: 'html' as ArtifactSourceLanguage,
    typeLabel: 'HTML Artifact',
    buildPreviewDocument: vi.fn((src: string) => `<html><body>${src}</body></html>`),
    onClose: vi.fn(),
    generateTurnId: () => 'test-turn-1',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      artifacts: {
        save: vi.fn().mockResolvedValue({ id: 'lib-record-1' }),
        list: vi.fn().mockResolvedValue([]),
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
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ArtifactDesigner — change-006 build loop wiring', () => {
  // -------------------------------------------------------------------------
  // 1. HTML create → preview → Save → draft shape, savedRecordId reflected
  // -------------------------------------------------------------------------

  it('HTML: save builds correct draft (kind html, sourceLanguage html) and reflects savedRecordId', async () => {
    const source = '<h1>My Page</h1>'
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makePreviewState(source, 'html')
    })
    // No ': SaveArtifactMock' annotation so TypeScript retains MockInstance for .mock.calls.
    const saveArtifact = vi.fn<SaveArtifactMock>().mockResolvedValue({ id: 'artifact-001' })

    render(
      <ArtifactDesigner
        {...makeProps({ runTurn, saveArtifact })}
        title="My HTML Artifact"
        language="html"
        initialSource="<p>init</p>"
      />
    )

    // Trigger a turn to reach preview phase.
    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Build my page' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    // Wait for Save button to appear (phase = preview).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.save/i })).toBeInTheDocument()
    )

    // Click Save.
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.save/i }))

    await waitFor(() => expect(saveArtifact).toHaveBeenCalledOnce())

    // Draft shape assertions.
    const draft: ArtifactRecordDraft = saveArtifact.mock.calls[0][0]
    expect(draft.source).toBe(source)
    expect(draft.kind).toBe('html')
    expect(draft.sourceLanguage).toBe('html')
    expect(draft.runtimeProfileId).toBe('html')
    expect(draft.title).toBe('My HTML Artifact')

    // Saved indicator becomes visible after resolve.
    await waitFor(() => expect(screen.getAllByText(/settings.artifacts.designer.saved/i).length).toBeGreaterThan(0))
  })

  // -------------------------------------------------------------------------
  // 2. React (tsx) → preview → Save builds draft with kind react
  // -------------------------------------------------------------------------

  it('React/tsx: save builds correct draft (kind react, sourceLanguage tsx, runtimeProfileId react-default)', async () => {
    const tsxSource = 'export default function App() { return <div>Hi</div> }'
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makePreviewState(tsxSource, 'tsx')
    })
    // No ': SaveArtifactMock' annotation so TypeScript retains MockInstance for .mock.calls.
    const saveArtifact = vi.fn<SaveArtifactMock>().mockResolvedValue({ id: 'artifact-tsx-001' })

    render(
      <ArtifactDesigner
        {...makeProps({ runTurn, saveArtifact })}
        title="My React Widget"
        language="tsx"
        initialSource="// empty"
      />
    )

    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Build a React widget' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.save/i })).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.save/i }))

    await waitFor(() => expect(saveArtifact).toHaveBeenCalledOnce())

    const draft: ArtifactRecordDraft = saveArtifact.mock.calls[0][0]
    expect(draft.source).toBe(tsxSource)
    expect(draft.kind).toBe('react')
    expect(draft.sourceLanguage).toBe('tsx')
    expect(draft.runtimeProfileId).toBe('react-default')
    expect(draft.title).toBe('My React Widget')
  })

  // -------------------------------------------------------------------------
  // 3. Failing build → repair phase → diagnostics shown → Fix it button shown
  // -------------------------------------------------------------------------

  it('shows Fix it button and diagnostics when build fails (repair phase)', async () => {
    const diagnostics = ['TS2322: Type mismatch at line 5', 'TS2339: Property does not exist']
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makeRepairState('<p>broken</p>', diagnostics)
    })

    render(<ArtifactDesigner {...makeProps({ runTurn })} />)

    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Build something' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    // Diagnostics appear in transcript.
    await waitFor(() => expect(screen.getAllByText(/TS2322: Type mismatch at line 5/).length).toBeGreaterThan(0))

    // Fix it button is present.
    expect(screen.getByRole('button', { name: /settings.artifacts.designer.fix_action/i })).toBeInTheDocument()

    // Save button NOT shown (phase is repair, not preview).
    expect(screen.queryByRole('button', { name: /settings.artifacts.designer.save/i })).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // 4. Fix it button triggers a second runTurn call
  // -------------------------------------------------------------------------

  it('Fix it button calls runTurn a second time; on success transitions to preview', async () => {
    const brokenSource = '<p>broken</p>'
    const fixedSource = '<p>fixed</p>'
    const diagnostics = ['TS2322: Type mismatch']

    const runTurn = vi
      .fn<RunTurnMock>()
      .mockResolvedValueOnce({
        events: [],
        state: makeRepairState(brokenSource, diagnostics)
      })
      .mockResolvedValueOnce({
        events: [],
        state: makePreviewState(fixedSource)
      })

    render(<ArtifactDesigner {...makeProps({ runTurn })} />)

    // First turn → repair.
    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Build it' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.fix_action/i })).toBeInTheDocument()
    )

    expect(runTurn).toHaveBeenCalledTimes(1)

    // Click Fix it → second turn.
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.fix_action/i }))

    await waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2))

    // After fix, preview iframe present.
    await waitFor(() => expect(screen.getByTitle(/settings.artifacts.designer.preview/i)).toBeInTheDocument())
  })

  // -------------------------------------------------------------------------
  // 5. Repaired → preview → Save persists new version
  // -------------------------------------------------------------------------

  it('after repair loop resolves to preview, Save persists the new source version', async () => {
    const brokenSource = '<p>broken</p>'
    const fixedSource = '<p>repaired and ready</p>'
    const diagnostics = ['TS9999: Something went wrong']

    const runTurn = vi
      .fn<RunTurnMock>()
      .mockResolvedValueOnce({
        events: [],
        state: makeRepairState(brokenSource, diagnostics)
      })
      .mockResolvedValueOnce({
        events: [],
        state: makePreviewState(fixedSource)
      })
    // No ': SaveArtifactMock' annotation so TypeScript retains MockInstance for .mock.calls.
    const saveArtifact = vi.fn<SaveArtifactMock>().mockResolvedValue({ id: 'repaired-artifact' })

    render(<ArtifactDesigner {...makeProps({ runTurn, saveArtifact })} />)

    // First turn → repair.
    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Build it' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.fix_action/i })).toBeInTheDocument()
    )

    // Fix it → preview.
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.fix_action/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.save/i })).toBeInTheDocument()
    )

    // Save → saveArtifact called with fixed source.
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.save/i }))

    await waitFor(() => expect(saveArtifact).toHaveBeenCalledOnce())

    const draft: ArtifactRecordDraft = saveArtifact.mock.calls[0][0]
    expect(draft.source).toBe(fixedSource)
  })

  // -------------------------------------------------------------------------
  // 6. Cancel (onClose) after edits does NOT call saveArtifact
  // -------------------------------------------------------------------------

  it('closing the designer after edits does not invoke saveArtifact', async () => {
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makePreviewState('<p>content</p>')
    })
    const saveArtifact: SaveArtifactMock = vi.fn()
    const onClose = vi.fn()

    render(<ArtifactDesigner {...makeProps({ runTurn, saveArtifact, onClose })} />)

    // Reach preview state.
    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Make something' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.save/i })).toBeInTheDocument()
    )

    // Click Cancel (close button), NOT Save.
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.cancel/i }))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())

    // saveArtifact must never have been called.
    expect(saveArtifact).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 7. Save button NOT shown when phase !== 'preview'
  // -------------------------------------------------------------------------

  it('Save button is absent when phase is idle (initial state)', () => {
    const runTurn: RunTurnMock = vi.fn()
    const saveArtifact: SaveArtifactMock = vi.fn()

    render(<ArtifactDesigner {...makeProps({ runTurn, saveArtifact })} />)

    // No turn has run — phase is idle.
    expect(screen.queryByRole('button', { name: /settings.artifacts.designer.save/i })).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // 8. Save button NOT shown when phase is 'repair'
  // -------------------------------------------------------------------------

  it('Save button is absent when phase is repair (build failed)', async () => {
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makeRepairState('<p>broken</p>', ['error'])
    })

    render(<ArtifactDesigner {...makeProps({ runTurn })} />)

    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Try it' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.fix_action/i })).toBeInTheDocument()
    )

    expect(screen.queryByRole('button', { name: /settings.artifacts.designer.save/i })).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // 9. saveArtifact rejects → error surfaced, savedRecordId not set
  // -------------------------------------------------------------------------

  it('when saveArtifact rejects, error is surfaced and no saved indicator shown', async () => {
    const source = '<h1>Page</h1>'
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makePreviewState(source)
    })
    const saveError = new Error('Network failure')
    const saveArtifact: SaveArtifactMock = vi.fn().mockRejectedValue(saveError)

    render(<ArtifactDesigner {...makeProps({ runTurn, saveArtifact })} />)

    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Build it' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.save/i })).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.save/i }))

    // Wait for save attempt to resolve/reject.
    await waitFor(() => expect(saveArtifact).toHaveBeenCalledOnce())

    // Error should be surfaced somewhere in the UI — in the transcript or alert region.
    await waitFor(() =>
      expect(screen.getAllByText(/settings.artifacts.designer.save_error|Network failure/).length).toBeGreaterThan(0)
    )

    // Saved indicator must NOT appear.
    expect(screen.queryByText(/settings.artifacts.designer.saved/i)).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // 10. Saving state: Save button shows loading while async save is in flight
  // -------------------------------------------------------------------------

  it('Save button is in loading/disabled state while saveArtifact is pending', async () => {
    const source = '<p>content</p>'
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makePreviewState(source)
    })

    let resolveSave!: (value: { id: string }) => void
    const pendingSave = new Promise<{ id: string }>((resolve) => {
      resolveSave = resolve
    })
    const saveArtifact: SaveArtifactMock = vi.fn().mockReturnValue(pendingSave)

    render(<ArtifactDesigner {...makeProps({ runTurn, saveArtifact })} />)

    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Build' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.save/i })).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.save/i }))

    // While pending, save button disabled.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.save/i })).toBeDisabled()
    )

    // Resolve the save.
    await act(async () => {
      resolveSave({ id: 'done-id' })
    })

    // Saved indicator appears.
    await waitFor(() => expect(screen.getAllByText(/settings.artifacts.designer.saved/i).length).toBeGreaterThan(0))
  })

  // -------------------------------------------------------------------------
  // 11. Fix it request auto-composes a repair instruction referencing diagnostics
  // -------------------------------------------------------------------------

  it('Fix it passes a non-empty request string to the second runTurn call', async () => {
    const diagnostics = ['TS2322: Type mismatch']

    const runTurn = vi
      .fn<RunTurnMock>()
      .mockResolvedValueOnce({
        events: [],
        state: makeRepairState('<p>broken</p>', diagnostics)
      })
      .mockResolvedValueOnce({
        events: [],
        state: makePreviewState('<p>fixed</p>')
      })

    render(<ArtifactDesigner {...makeProps({ runTurn })} />)

    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Build it' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.fix_action/i })).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.fix_action/i }))

    await waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2))

    // The second call must include a non-empty request string.
    const secondCallArgs = runTurn.mock.calls[1][0]
    expect(secondCallArgs.request.length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // 12. Fix it button is in-flight disabled during second turn
  // -------------------------------------------------------------------------

  it('Fix it button is disabled while the repair turn is in flight', async () => {
    const diagnostics = ['TS2322: error']

    let resolveSecondTurn!: (value: { events: ArtifactDesignEvent[]; state: EditorState }) => void
    const pendingSecond = new Promise<{ events: ArtifactDesignEvent[]; state: EditorState }>((resolve) => {
      resolveSecondTurn = resolve
    })

    const runTurn = vi
      .fn<RunTurnMock>()
      .mockResolvedValueOnce({
        events: [],
        state: makeRepairState('<p>broken</p>', diagnostics)
      })
      .mockReturnValueOnce(pendingSecond)

    render(<ArtifactDesigner {...makeProps({ runTurn })} />)

    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Build it' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.fix_action/i })).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.fix_action/i }))

    // During second turn, Fix it button (and send) should be disabled.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.fix_action/i })).toBeDisabled()
    )

    // Resolve so the test doesn't leak.
    await act(async () => {
      resolveSecondTurn({ events: [], state: makePreviewState('<p>fixed</p>') })
    })
  })

  // -------------------------------------------------------------------------
  // 13. Empty title fallback: Save with title="" uses the untitled key
  // -------------------------------------------------------------------------

  it('empty title fallback: Save called with title="" uses untitled fallback in the draft', async () => {
    const source = '<p>Content</p>'
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makePreviewState(source, 'html')
    })
    // No ': SaveArtifactMock' annotation so TypeScript retains MockInstance for .mock.calls.
    const saveArtifact = vi.fn<SaveArtifactMock>().mockResolvedValue({ id: 'untitled-record' })

    render(
      <ArtifactDesigner
        {...makeProps({ runTurn, saveArtifact })}
        title=""
        language="html"
        initialSource="<p>init</p>"
      />
    )

    // Drive to preview phase.
    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Build it' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.save/i })).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.save/i }))

    await waitFor(() => expect(saveArtifact).toHaveBeenCalledOnce())

    const draft: ArtifactRecordDraft = saveArtifact.mock.calls[0][0]
    // The draft title must be non-empty — the untitled fallback was applied.
    expect(draft.title).toBeTruthy()
    expect(draft.title.trim()).not.toBe('')
  })

  // -------------------------------------------------------------------------
  // 14. Empty source guard: Save with blank source must NOT call saveArtifact
  // -------------------------------------------------------------------------

  it('empty source guard: Save is blocked and saveArtifact is NOT called when source is blank', async () => {
    // Inject a runTurn that returns preview phase with empty source.
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makePreviewState('   ', 'html')
    })
    const saveArtifact = vi.fn<SaveArtifactMock>().mockResolvedValue({ id: 'should-never-be-called' })

    render(<ArtifactDesigner {...makeProps({ runTurn, saveArtifact })} language="html" initialSource="<p>init</p>" />)

    // Drive to preview phase with blank source.
    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Build it' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.save/i })).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.save/i }))

    // Allow any async work to settle.
    await act(async () => {})

    // saveArtifact must NEVER have been called.
    expect(saveArtifact).not.toHaveBeenCalled()

    // A save-error message should be surfaced somewhere.
    expect(screen.getAllByText(/settings.artifacts.designer.save_error_empty_source/).length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // 15. jsx draft shape: language='jsx' → kind 'react', runtimeProfileId 'react-default'
  // -------------------------------------------------------------------------

  it('jsx: Save builds correct draft (kind react, runtimeProfileId react-default, sourceLanguage jsx)', async () => {
    const jsxSource = 'export default function App() { return <div>Hi</div> }'
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makePreviewState(jsxSource, 'jsx')
    })
    // No ': SaveArtifactMock' annotation so TypeScript retains MockInstance for .mock.calls.
    const saveArtifact = vi.fn<SaveArtifactMock>().mockResolvedValue({ id: 'jsx-001' })

    render(
      <ArtifactDesigner
        {...makeProps({ runTurn, saveArtifact })}
        title="My JSX Widget"
        language="jsx"
        initialSource="// empty"
      />
    )

    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Build a JSX widget' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.save/i })).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.save/i }))

    await waitFor(() => expect(saveArtifact).toHaveBeenCalledOnce())

    const draft: ArtifactRecordDraft = saveArtifact.mock.calls[0][0]
    expect(draft.kind).toBe('react')
    expect(draft.runtimeProfileId).toBe('react-default')
    expect(draft.sourceLanguage).toBe('jsx')
  })

  // -------------------------------------------------------------------------
  // 16. Post-save UI: after successful save, phase transitions to idle
  // -------------------------------------------------------------------------

  it('post-save UI: after successful save the saved indicator is shown and phase is idle', async () => {
    const source = '<p>Final content</p>'
    const runTurn: RunTurnMock = vi.fn().mockResolvedValue({
      events: [],
      state: makePreviewState(source, 'html')
    })
    // No ': SaveArtifactMock' annotation so TypeScript retains MockInstance for .mock.calls.
    const saveArtifact = vi.fn<SaveArtifactMock>().mockResolvedValue({ id: 'post-save-001' })

    render(<ArtifactDesigner {...makeProps({ runTurn, saveArtifact })} />)

    fireEvent.change(screen.getByRole('textbox', { name: /settings.artifacts.designer.prompt/i }), {
      target: { value: 'Build it' }
    })
    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.send/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.artifacts.designer.save/i })).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /settings.artifacts.designer.save/i }))

    await waitFor(() => expect(saveArtifact).toHaveBeenCalledOnce())

    // Saved indicator visible — phase is idle (savedRecordId set directly).
    await waitFor(() => expect(screen.getAllByText(/settings.artifacts.designer.saved/i).length).toBeGreaterThan(0))

    // Save button should no longer be visible (phase is idle, not preview).
    expect(screen.queryByRole('button', { name: /settings.artifacts.designer.save/i })).not.toBeInTheDocument()
  })
})
