/**
 * ArtifactDesigner.tsx — 3-pane iterative artifact designer (change-005).
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
 * Save boundary: The save button calls onSaveToLibrary?(state.source) when
 * present. Deeper wiring of artifact_saved into the reducer (change-006) is
 * intentionally left to the next iteration; the button is wired and visible
 * in v1 whenever phase === 'preview'.
 *
 * runTurn seam: Defaults to runDesignTurnDefault in production. Tests inject
 * a mock so no real model or IPC call is ever triggered in unit tests.
 */

import { loggerService } from '@logger'
import CodeEditor from '@renderer/components/CodeEditor'
import { Button, Splitter, Tooltip } from 'antd'
import { SendHorizonal, Save } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
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
  /** Caller maps source → preview iframe document. Injected for testability. */
  buildPreviewDocument: (source: string) => string
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
// Status text helper
// ---------------------------------------------------------------------------

function phaseStatusKey(phase: EditorState['phase']): string {
  switch (phase) {
    case 'streaming':
      return 'artifacts.designer.status.streaming'
    case 'building':
      return 'artifacts.designer.status.building'
    case 'repair':
      return 'artifacts.designer.status.repair'
    case 'error':
      return 'artifacts.designer.status.error'
    case 'preview':
      return 'artifacts.designer.status.preview'
    case 'saving':
      return 'artifacts.designer.status.saving'
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
  onSaveToLibrary,
  onClose: _onClose,
  runTurn: runTurnProp,
  generateTurnId
}: ArtifactDesignerProps) => {
  const { t } = useTranslation()

  // EditorState via useState — replaced wholesale with the runTurn result.
  // (Using useReducer would require threading every ArtifactDesignEvent through
  // individually; since runTurn already applies the reducer sequence and returns
  // the final state, useState + direct replacement is simpler and correct.)
  const [editorState, setEditorState] = useState<EditorState>(() =>
    initEditorState({ source: initialSource, language })
  )

  const [inFlight, setInFlight] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const turnCounterRef = useRef(0)

  // Per-instance turn ID generator — avoids sharing state across mounted instances.
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
  // Send handler
  // ---------------------------------------------------------------------------

  const handleSend = useCallback(async () => {
    const request = promptText.trim()
    if (!request || inFlight) {
      return
    }

    // Set inFlight BEFORE the async resolution to prevent double-submit races.
    setInFlight(true)

    const resolvedRunTurn = runTurnProp ?? (await resolveDefaultRunTurn())
    const turnId = resolvedGenerateTurnId()

    appendTranscript({ role: 'user', text: request })
    setPromptText('')

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
  }, [appendTranscript, editorState, resolvedGenerateTurnId, inFlight, language, promptText, runTurnProp, t, title])

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    if (!onSaveToLibrary || isSaving) {
      return
    }

    setIsSaving(true)
    try {
      await onSaveToLibrary(editorState.source)
    } catch (error) {
      logger.error('Save to library failed', error instanceof Error ? error : new Error(String(error)))
    } finally {
      setIsSaving(false)
    }
  }, [editorState.source, isSaving, onSaveToLibrary])

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

  if (!open) {
    return null
  }

  const isPreview = editorState.phase === 'preview'

  // Memoize the preview document to avoid recomputing on unrelated re-renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const previewDoc = useMemo(
    () => (isPreview ? buildPreviewDocument(editorState.source) : ''),
    [isPreview, buildPreviewDocument, editorState.source]
  )

  return (
    <DesignerContainer>
      <Splitter>
        {/* ----------------------------------------------------------------- */}
        {/* Chat pane                                                          */}
        {/* ----------------------------------------------------------------- */}
        <Splitter.Panel>
          <ChatPane>
            {/*
             * Assertive live region for errors — announced immediately by screen
             * readers, complementing the polite transcript log below.
             */}
            <VisuallyHidden role="alert" aria-live="assertive">
              {editorState.phase === 'error'
                ? (editorState.error ?? '')
                : editorState.phase === 'repair'
                  ? (editorState.lastBuild?.diagnostics ?? []).join('. ')
                  : ''}
            </VisuallyHidden>

            <Transcript
              role="log"
              aria-live="polite"
              aria-busy={inFlight}
              aria-label={t('artifacts.designer.transcript_label')}>
              {transcript.map((entry) => (
                <TranscriptItem key={entry.id} $role={entry.role}>
                  {entry.text}
                </TranscriptItem>
              ))}
            </Transcript>

            <PromptArea>
              <label htmlFor="designer-prompt" className="sr-only">
                {t('artifacts.designer.prompt_label')}
              </label>
              <PromptTextarea
                id="designer-prompt"
                aria-label={t('artifacts.designer.prompt_label')}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('artifacts.designer.prompt')}
                disabled={inFlight}
                rows={3}
              />
              <PromptActions>
                {onSaveToLibrary && isPreview && (
                  <Tooltip title={t('artifacts.designer.save')} mouseLeaveDelay={0}>
                    <Button
                      icon={<Save size={16} />}
                      aria-label={t('artifacts.designer.save')}
                      loading={isSaving}
                      disabled={isSaving}
                      onClick={() => void handleSave()}
                    />
                  </Tooltip>
                )}
                <Tooltip title={t('artifacts.designer.send')} mouseLeaveDelay={0}>
                  <Button
                    type="primary"
                    icon={<SendHorizonal size={16} />}
                    aria-label={t('artifacts.designer.send')}
                    disabled={inFlight || !promptText.trim()}
                    loading={inFlight}
                    onClick={() => void handleSend()}>
                    {t('artifacts.designer.send')}
                  </Button>
                </Tooltip>
              </PromptActions>
            </PromptArea>
          </ChatPane>
        </Splitter.Panel>

        {/* ----------------------------------------------------------------- */}
        {/* Code pane (v1: read-only; manual editing is change-006+)           */}
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
              // Combining allow-scripts + allow-same-origin permits sandbox escape
              // for model-generated code (it can reach the parent frame's origin).
              // There is no postMessage bridge here that requires same-origin.
              <PreviewFrame
                srcDoc={previewDoc}
                title={t('artifacts.designer.preview_title')}
                sandbox="allow-scripts allow-forms"
              />
            ) : (
              <PreviewPlaceholder>
                {editorState.phase === 'error' || editorState.phase === 'repair'
                  ? null
                  : t('html_artifacts.empty_preview', 'No content to preview')}
              </PreviewPlaceholder>
            )}
          </PreviewPane>
        </Splitter.Panel>
      </Splitter>
    </DesignerContainer>
  )
}

// ---------------------------------------------------------------------------
// Lazy default runTurn resolver — imported only at call time so module-scope
// is kept free of real service imports (matching the pattern from
// designOrchestrator.default.ts).
// ---------------------------------------------------------------------------

async function resolveDefaultRunTurn() {
  const { runDesignTurnDefault } = await import('../../artifacts/designOrchestrator.default')
  return runDesignTurnDefault
}

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

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
