/**
 * ArtifactDesigner.tsx — 3-pane iterative artifact designer (change-005/006).
 *
 * Architecture decision: This is a NEW sibling component, not a mode-branch
 * inside ArtifactPopup.tsx. ArtifactPopup is entirely unchanged, preserving
 * its viewer/manual-editor behaviour. ArtifactDesigner imports nothing from
 * ArtifactPopup; it uses the same underlying primitives directly.
 *
 * Pane layout:  Chat │ Code │ Preview
 *
 * Code pane (v1): read-only display of current state.source. Manual editing
 * is deferred to a future change; the CodeEditor is rendered with
 * editable=false in v1. This is documented here as the code-edit boundary.
 *
 * Save boundary (change-006):
 * The save button is enabled only when phase === 'preview'. It calls the
 * injected saveArtifact seam with an ArtifactRecordDraft constructed from the
 * current editorState. On success, savedRecordId is updated directly via
 * setEditorState — NOT via the reducer's artifact_saved event.
 *
 * Decision record — why NOT artifact_saved:
 * The reducer's handleArtifactSaved guard checks event.turnId !== activeTurnId
 * and silently drops mismatched events. After design_run_complete, activeTurnId
 * is null. Any artifact_saved event dispatched at that point would fail the
 * guard (turnId !== null) and be dropped. Library persistence is a post-turn,
 * component-level concern; the component sets savedRecordId directly.
 *
 * Repair loop (change-006):
 * When phase === 'repair', a "Fix it" button triggers a second orchestrator turn
 * whose request is an auto-composed repair instruction. The normal prompt box
 * also remains active during repair for manual guidance.
 *
 * runTurn seam: Defaults to runDesignTurnDefault in production. Tests inject
 * a mock so no real model or IPC call is ever triggered in unit tests.
 *
 * saveArtifact seam: Injected as a prop. Default is undefined (no-op guard).
 * The parent wires useArtifactLibrary().saveArtifact. Tests inject a mock.
 */

import { loggerService } from '@logger'
import CodeEditor from '@renderer/components/CodeEditor'
import type { ArtifactRecordDraft } from '@shared/artifacts'
import { Button, Modal, Splitter, Tooltip } from 'antd'
import { Save, SendHorizonal, Wrench, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { ArtifactDesignEvent, ArtifactSourceLanguage } from '../../artifacts/designProtocol'
import type { EditorState } from '../../artifacts/editorReducer'
import { initEditorState } from '../../artifacts/editorReducer'

const logger = loggerService.withContext('ArtifactDesigner')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArtifactDesignerProps {
  open: boolean
  title: string
  initialSource: string
  language: ArtifactSourceLanguage
  typeLabel: string
  /**
   * Caller maps source → preview iframe document.
   * Accepts a sync or async mapper; the designer resolves it via useEffect.
   * Async is needed for React artifacts (compileReact is an async IPC call).
   * HTML artifacts pass a sync builder; React artifacts pass an async one.
   * Injected for testability — tests pass a sync vi.fn().
   */
  buildPreviewDocument: (source: string) => string | Promise<string>
  /**
   * Testability seam for library persistence. Defaults to undefined (no save).
   * The parent should wire useArtifactLibrary().saveArtifact here.
   * Tests inject a mock returning { id: string }.
   */
  saveArtifact?: (draft: ArtifactRecordDraft) => Promise<{ id: string }>
  /**
   * Legacy compat — if provided and saveArtifact is not, falls back to this.
   * Prefer saveArtifact for change-006+ wiring.
   */
  onSaveToLibrary?: (source: string) => Promise<void>
  onClose: () => void
  /**
   * Testability seam: defaults to runDesignTurnDefault in production.
   * Tests inject a mock so the component never imports the real orchestrator.
   */
  runTurn?: (args: {
    state: EditorState
    request: string
    language: ArtifactSourceLanguage
    turnId: string
    title?: string
  }) => Promise<{ events: ArtifactDesignEvent[]; state: EditorState }>
  /**
   * Testability: deterministic turnId generator.
   * Default uses a per-instance monotonic counter.
   */
  generateTurnId?: () => string
}

// ---------------------------------------------------------------------------
// Transcript entry type — local to this component.
// ---------------------------------------------------------------------------

interface TranscriptEntry {
  readonly id: string
  readonly role: 'user' | 'status'
  readonly text: string
}

// ---------------------------------------------------------------------------
// Language → ArtifactRecordDraft field mappings
// ---------------------------------------------------------------------------

function languageToKind(lang: ArtifactSourceLanguage): ArtifactRecordDraft['kind'] {
  return lang === 'html' ? 'html' : 'react'
}

function languageToRuntimeProfileId(lang: ArtifactSourceLanguage): ArtifactRecordDraft['runtimeProfileId'] {
  return lang === 'html' ? 'html' : 'react-default'
}

// ---------------------------------------------------------------------------
// Status text helper
// ---------------------------------------------------------------------------

function phaseStatusKey(phase: EditorState['phase']): string {
  switch (phase) {
    case 'streaming':
      return 'settings.artifacts.designer.status.streaming'
    case 'building':
      return 'settings.artifacts.designer.status.building'
    case 'repair':
      return 'settings.artifacts.designer.status.repair'
    case 'error':
      return 'settings.artifacts.designer.status.error'
    case 'preview':
      return 'settings.artifacts.designer.status.preview'
    case 'saving':
      return 'settings.artifacts.designer.status.saving'
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ArtifactDesigner = ({
  open,
  title,
  initialSource,
  language,
  typeLabel: _typeLabel,
  buildPreviewDocument,
  saveArtifact: saveArtifactProp,
  onSaveToLibrary,
  onClose,
  runTurn: runTurnProp,
  generateTurnId
}: ArtifactDesignerProps) => {
  const { t } = useTranslation()

  // EditorState via useState — replaced wholesale with the runTurn result.
  const [editorState, setEditorState] = useState<EditorState>(() =>
    initEditorState({ source: initialSource, language })
  )

  const [inFlight, setInFlight] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Preview document resolved from buildPreviewDocument (sync or async).
  const [previewDoc, setPreviewDoc] = useState('')

  const turnCounterRef = useRef(0)

  // Per-instance turn ID generator.
  const defaultGen = useCallback(() => {
    turnCounterRef.current += 1
    return `designer-turn-${turnCounterRef.current}`
  }, [])

  const resolvedGenerateTurnId = generateTurnId ?? defaultGen

  // Append an entry to the transcript (immutable).
  const appendTranscript = useCallback((entry: Omit<TranscriptEntry, 'id'>) => {
    setTranscript((prev) => [...prev, { ...entry, id: `entry-${Date.now()}-${Math.random().toString(36).slice(2)}` }])
  }, [])

  // ---------------------------------------------------------------------------
  // Core turn executor — shared by handleSend and handleFixIt.
  // ---------------------------------------------------------------------------

  const executeTurn = useCallback(
    async (request: string) => {
      if (inFlight) return

      setInFlight(true)
      setSaveError(null)

      const resolvedRunTurn = runTurnProp ?? (await resolveDefaultRunTurn())
      const turnId = resolvedGenerateTurnId()

      appendTranscript({ role: 'user', text: request })

      try {
        const result = await resolvedRunTurn({
          state: editorState,
          request,
          language,
          turnId,
          title
        })

        setEditorState(result.state)

        const statusKey = phaseStatusKey(result.state.phase)
        if (statusKey) {
          appendTranscript({ role: 'status', text: t(statusKey) })
        }

        // Surface build diagnostics in the transcript when build failed.
        if (result.state.phase === 'repair' && result.state.lastBuild) {
          for (const diag of result.state.lastBuild.diagnostics) {
            appendTranscript({ role: 'status', text: diag })
          }
        }

        // Surface error message.
        if (result.state.phase === 'error' && result.state.error) {
          appendTranscript({ role: 'status', text: result.state.error })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Design turn failed', error instanceof Error ? error : new Error(message))
        appendTranscript({ role: 'status', text: message })
        setEditorState((prev) => ({ ...prev, phase: 'error', error: message, activeTurnId: null }))
      } finally {
        setInFlight(false)
      }
    },
    [appendTranscript, editorState, resolvedGenerateTurnId, inFlight, language, runTurnProp, t, title]
  )

  // ---------------------------------------------------------------------------
  // Send handler — submits the prompt text.
  // ---------------------------------------------------------------------------

  const handleSend = useCallback(async () => {
    const request = promptText.trim()
    if (!request || inFlight) return

    setPromptText('')
    await executeTurn(request)
  }, [executeTurn, inFlight, promptText])

  // ---------------------------------------------------------------------------
  // Fix it handler — auto-composes a repair request from diagnostics.
  // ---------------------------------------------------------------------------

  const handleFixIt = useCallback(async () => {
    if (inFlight || editorState.phase !== 'repair') return

    const diagnostics = editorState.lastBuild?.diagnostics ?? []
    const diagText = diagnostics.join('\n')
    const request =
      diagText.length > 0
        ? `${t('settings.artifacts.designer.fix_request')}\n\n${diagText}`
        : t('settings.artifacts.designer.fix_request')

    await executeTurn(request)
  }, [editorState.lastBuild?.diagnostics, editorState.phase, executeTurn, inFlight, t])

  // ---------------------------------------------------------------------------
  // Save handler — builds a draft and persists via the saveArtifact seam.
  //
  // Decision: savedRecordId is set directly on editorState after resolve.
  // See module-level doc comment for the full rationale (artifact_saved would
  // be dropped by the reducer's turn-scoped guard when activeTurnId is null).
  // ---------------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    if (isSaving || editorState.phase !== 'preview') return

    // Empty-source guard — cannot save a blank artifact.
    if (!editorState.source.trim()) {
      const errText = t('settings.artifacts.designer.save_error_empty_source')
      setSaveError(errText)
      appendTranscript({ role: 'status', text: errText })
      return
    }

    // No saveArtifact seam → fall back to legacy onSaveToLibrary if provided.
    if (!saveArtifactProp) {
      if (onSaveToLibrary) {
        setIsSaving(true)
        try {
          await onSaveToLibrary(editorState.source)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.error('Save to library failed (legacy)', error instanceof Error ? error : new Error(message))
          setSaveError(t('settings.artifacts.designer.save_error'))
          appendTranscript({ role: 'status', text: t('settings.artifacts.designer.save_error') })
        } finally {
          setIsSaving(false)
        }
      }
      return
    }

    setIsSaving(true)
    setSaveError(null)

    // Empty-title fallback — use untitled placeholder rather than an empty string.
    const resolvedTitle = title.trim() || t('settings.artifacts.designer.untitled')

    const draft: ArtifactRecordDraft = {
      title: resolvedTitle,
      kind: languageToKind(editorState.language),
      runtimeProfileId: languageToRuntimeProfileId(editorState.language),
      sourceLanguage: editorState.language,
      source: editorState.source,
      themeId: 'boss-light',
      accessPolicy: {
        internetEnabled: true,
        serviceIds: [],
        serviceToolIds: []
      }
    }

    try {
      const { id } = await saveArtifactProp(draft)
      // Direct state update — post-turn library save is a component concern.
      setEditorState((prev) => ({ ...prev, savedRecordId: id, phase: 'idle' }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Save to library failed', error instanceof Error ? error : new Error(message))
      const errText = t('settings.artifacts.designer.save_error')
      setSaveError(errText)
      appendTranscript({ role: 'status', text: errText })
    } finally {
      setIsSaving(false)
    }
  }, [appendTranscript, editorState, isSaving, onSaveToLibrary, saveArtifactProp, t, title])

  // ---------------------------------------------------------------------------
  // Keyboard: submit on Ctrl+Enter / Cmd+Enter
  // ---------------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        void handleSend()
      }
    },
    [handleSend]
  )

  const isPreview = editorState.phase === 'preview'
  const isRepair = editorState.phase === 'repair'
  const isSaved = editorState.savedRecordId !== null

  // Resolve the preview document — buildPreviewDocument may be sync or async.
  // The useEffect is placed before the early return so hooks are never called
  // conditionally (rules of hooks). When !isPreview the effect clears the doc.
  useEffect(() => {
    if (!isPreview) {
      setPreviewDoc('')
      return
    }

    let cancelled = false
    const result = buildPreviewDocument(editorState.source)

    if (typeof result === 'string') {
      setPreviewDoc(result)
    } else {
      result.then((doc) => {
        if (!cancelled) setPreviewDoc(doc)
      })
    }

    return () => {
      cancelled = true
    }
  }, [isPreview, buildPreviewDocument, editorState.source])

  if (!open) {
    return null
  }

  return (
    <DesignerModal
      open={open}
      footer={null}
      closable={false}
      width="100vw"
      style={{ maxWidth: '100vw', height: '100vh', top: 0, paddingBottom: 0 }}
      styles={{ body: { height: 'calc(100vh - 55px)', padding: 0, overflow: 'hidden' } }}
      onCancel={onClose}
      destroyOnHidden>
      <DesignerContainer>
        <Splitter>
          {/* ----------------------------------------------------------------- */}
          {/* Chat pane                                                          */}
          {/* ----------------------------------------------------------------- */}
          <Splitter.Panel>
            <ChatPane>
              {/*
               * Assertive live region for errors — announced immediately by
               * screen readers, complementing the polite transcript log below.
               */}
              <VisuallyHidden role="alert" aria-live="assertive">
                {editorState.phase === 'error'
                  ? (editorState.error ?? '')
                  : isRepair
                    ? (editorState.lastBuild?.diagnostics ?? []).join('. ')
                    : (saveError ?? '')}
              </VisuallyHidden>

              {/* Polite live region for saved confirmation */}
              <VisuallyHidden aria-live="polite">
                {isSaved ? t('settings.artifacts.designer.saved') : ''}
              </VisuallyHidden>

              <Transcript
                role="log"
                aria-live="polite"
                aria-busy={inFlight}
                aria-label={t('settings.artifacts.designer.transcript_label')}>
                {transcript.map((entry) => (
                  <TranscriptItem key={entry.id} $role={entry.role}>
                    {entry.text}
                  </TranscriptItem>
                ))}
              </Transcript>

              {/* Saved indicator (visible when savedRecordId is set) */}
              {isSaved && <SavedIndicator role="status">{t('settings.artifacts.designer.saved')}</SavedIndicator>}

              <PromptArea>
                <label htmlFor="designer-prompt" className="sr-only">
                  {t('settings.artifacts.designer.prompt_label')}
                </label>
                <PromptTextarea
                  id="designer-prompt"
                  aria-label={t('settings.artifacts.designer.prompt_label')}
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t('settings.artifacts.designer.prompt')}
                  disabled={inFlight}
                  rows={3}
                />
                <PromptActions>
                  {/* Cancel / close button — always visible */}
                  <Tooltip title={t('settings.artifacts.designer.cancel')} mouseLeaveDelay={0}>
                    <Button
                      icon={<X size={16} />}
                      aria-label={t('settings.artifacts.designer.cancel')}
                      onClick={onClose}
                    />
                  </Tooltip>

                  {/* Fix it button — visible when phase is 'repair' */}
                  {isRepair && (
                    <Tooltip title={t('settings.artifacts.designer.fix_action')} mouseLeaveDelay={0}>
                      <Button
                        icon={<Wrench size={16} />}
                        aria-label={t('settings.artifacts.designer.fix_action')}
                        loading={inFlight}
                        disabled={inFlight}
                        onClick={() => void handleFixIt()}>
                        {t('settings.artifacts.designer.fix_action')}
                      </Button>
                    </Tooltip>
                  )}

                  {/* Save button — visible only when phase is 'preview' */}
                  {isPreview && (saveArtifactProp ?? onSaveToLibrary) && (
                    <Tooltip title={t('settings.artifacts.designer.save')} mouseLeaveDelay={0}>
                      <Button
                        icon={<Save size={16} />}
                        aria-label={t('settings.artifacts.designer.save')}
                        loading={isSaving}
                        disabled={isSaving}
                        onClick={() => void handleSave()}
                      />
                    </Tooltip>
                  )}

                  <Tooltip title={t('settings.artifacts.designer.send')} mouseLeaveDelay={0}>
                    <Button
                      type="primary"
                      icon={<SendHorizonal size={16} />}
                      aria-label={t('settings.artifacts.designer.send')}
                      disabled={inFlight || !promptText.trim()}
                      loading={inFlight}
                      onClick={() => void handleSend()}>
                      {t('settings.artifacts.designer.send')}
                    </Button>
                  </Tooltip>
                </PromptActions>
              </PromptArea>
            </ChatPane>
          </Splitter.Panel>

          {/* ----------------------------------------------------------------- */}
          {/* Code pane (v1: read-only; manual editing is future work)           */}
          {/* ----------------------------------------------------------------- */}
          <Splitter.Panel>
            <CodePane>
              <CodeEditor
                value={editorState.source}
                language={editorState.language}
                editable={false}
                height="100%"
                expanded={false}
                wrapped
                style={{ minHeight: 0 }}
                options={{ stream: false, lineNumbers: true, keymap: false }}
                aria-label="artifact-source"
              />
            </CodePane>
          </Splitter.Panel>

          {/* ----------------------------------------------------------------- */}
          {/* Preview pane — only shows iframe when phase = preview              */}
          {/* ----------------------------------------------------------------- */}
          <Splitter.Panel>
            <PreviewPane>
              {isPreview ? (
                // Security: allow-same-origin is intentionally omitted.
                // Combining allow-scripts + allow-same-origin permits sandbox
                // escape for model-generated code (it can reach the parent
                // frame's origin). There is no postMessage bridge here that
                // requires same-origin.
                <PreviewFrame
                  srcDoc={previewDoc}
                  title={t('settings.artifacts.designer.preview_title')}
                  sandbox="allow-scripts allow-forms"
                />
              ) : (
                <PreviewPlaceholder>
                  {editorState.phase === 'error' || isRepair
                    ? null
                    : t('html_artifacts.empty_preview', 'No content to preview')}
                </PreviewPlaceholder>
              )}
            </PreviewPane>
          </Splitter.Panel>
        </Splitter>
      </DesignerContainer>
    </DesignerModal>
  )
}

// ---------------------------------------------------------------------------
// Lazy default runTurn resolver — imported only at call time so module-scope
// is kept free of real service imports.
// ---------------------------------------------------------------------------

async function resolveDefaultRunTurn() {
  const { runDesignTurnDefault } = await import('../../artifacts/designOrchestrator.default')
  return runDesignTurnDefault
}

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const DesignerModal = styled(Modal)`
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  z-index: 10000 !important;

  .ant-modal-wrap {
    padding: 0 !important;
    position: fixed !important;
    inset: 0 !important;
  }

  .ant-modal {
    margin: 0 !important;
    padding: 0 !important;
    max-width: none !important;
    position: fixed !important;
    inset: 0 !important;
  }

  .ant-modal-content {
    border-radius: 0;
    overflow: hidden;
    height: 100vh;
    padding: 0 !important;
  }

  .ant-modal-body {
    padding: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    max-height: initial !important;
  }
`

const DesignerContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: var(--color-background);
`

const ChatPane = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  border-right: 1px solid var(--color-border);
`

/** Visually hidden but present in the accessibility tree. */
const VisuallyHidden = styled.div`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`

const Transcript = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const TranscriptItem = styled.div<{ $role: 'user' | 'status' }>`
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;

  ${({ $role }) =>
    $role === 'user'
      ? `
    background: var(--color-primary-bg, rgba(37, 99, 235, 0.08));
    color: var(--color-text);
    align-self: flex-end;
    max-width: 85%;
  `
      : `
    background: var(--color-background-mute);
    color: var(--color-text-secondary);
    align-self: flex-start;
    max-width: 100%;
    border: 1px solid var(--color-border);
  `}
`

const SavedIndicator = styled.div`
  padding: 6px 12px;
  font-size: 12px;
  color: var(--color-success, #22c55e);
  text-align: center;
  border-top: 1px solid var(--color-border);
`

const PromptArea = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--color-border);
`

const PromptTextarea = styled.textarea`
  width: 100%;
  resize: none;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.5;
  background: var(--color-background);
  color: var(--color-text);
  outline: none;
  font-family: inherit;

  &:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-bg, rgba(37, 99, 235, 0.15));
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const PromptActions = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
`

const CodePane = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  border-right: 1px solid var(--color-border);
`

const PreviewPane = styled.div`
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: var(--color-background);
`

const PreviewFrame = styled.iframe`
  width: 100%;
  height: 100%;
  border: none;
  background: var(--color-background);
`

const PreviewPlaceholder = styled.div`
  height: 100%;
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  color: var(--color-text-secondary);
  font-size: 14px;
  background: var(--color-background-soft);
`

export default ArtifactDesigner
