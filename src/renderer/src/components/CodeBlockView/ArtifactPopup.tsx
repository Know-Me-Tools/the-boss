import type { CodeEditorHandles } from '@renderer/components/CodeEditor'
import CodeEditor from '@renderer/components/CodeEditor'
import { CopyIcon, FilePngIcon } from '@renderer/components/Icons'
import { isMac } from '@renderer/config/constant'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { classNames } from '@renderer/utils'
import { captureScrollableIframeAsBlob, captureScrollableIframeAsDataURL } from '@renderer/utils/image'
import type { ArtifactRecordDraft } from '@shared/artifacts'
import { Button, Dropdown, Modal, Splitter, Tooltip, Typography } from 'antd'
import {
  BookMarked,
  Camera,
  Check,
  Code,
  Eye,
  Maximize2,
  Minimize2,
  SaveIcon,
  SquareSplitHorizontal,
  X
} from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface CodePanelProps {
  codeEditorRef: React.RefObject<CodeEditorHandles | null>
  code: string
  codeLanguage: string
  onSave?: (code: string) => void
  saved: boolean
  onClickSave: () => void
  saveLabel: string
}

const CodePanel = memo<CodePanelProps>(
  ({ codeEditorRef, code, codeLanguage, onSave, saved, onClickSave, saveLabel }) => {
    return (
      <CodeSection>
        <CodeEditor
          ref={codeEditorRef}
          value={code}
          language={codeLanguage}
          editable={true}
          onSave={onSave}
          height="100%"
          expanded={false}
          wrapped
          style={{ minHeight: 0 }}
          options={{
            stream: true,
            lineNumbers: true,
            keymap: true
          }}
        />
        <ToolbarWrapper>
          <Tooltip title={saveLabel} mouseLeaveDelay={0}>
            <ToolbarButton
              shape="circle"
              size="large"
              icon={
                saved ? (
                  <Check size={16} color="var(--color-status-success)" />
                ) : (
                  <SaveIcon size={16} className="custom-lucide" />
                )
              }
              onClick={onClickSave}
            />
          </Tooltip>
        </ToolbarWrapper>
      </CodeSection>
    )
  }
)

interface PreviewPanelProps {
  previewFrameRef: React.RefObject<HTMLIFrameElement | null>
  previewDocument: string
  previewTitle: string
  emptyText: string
}

const PreviewPanel = memo<PreviewPanelProps>(({ previewFrameRef, previewDocument, previewTitle, emptyText }) => {
  return (
    <PreviewSection>
      {previewDocument.trim() ? (
        <PreviewFrame
          ref={previewFrameRef}
          srcDoc={previewDocument}
          title={previewTitle}
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      ) : (
        <EmptyPreview>
          <p>{emptyText}</p>
        </EmptyPreview>
      )}
    </PreviewSection>
  )
})

export interface ArtifactPopupProps {
  open: boolean
  title: string
  code: string
  codeLanguage: string
  typeLabel: string
  previewDocument: string
  onSave?: (code: string) => void
  createLibraryDraft?: (source: string) => Promise<ArtifactRecordDraft>
  onClose: () => void
}

type ViewMode = 'split' | 'code' | 'preview'

const ArtifactPopup = ({
  open,
  title,
  code,
  codeLanguage,
  typeLabel,
  previewDocument,
  onSave,
  createLibraryDraft,
  onClose
}: ArtifactPopupProps) => {
  const { t } = useTranslation()
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [isFullscreen, setIsFullscreen] = useState(true)
  const [saved, setSaved] = useTemporaryValue(false, 2000)
  const [savingToLibrary, setSavingToLibrary] = useState(false)
  const [splitSizes, setSplitSizes] = useState<string[]>(['50%', '50%'])
  const codeEditorRef = useRef<CodeEditorHandles>(null)
  const previewFrameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const disposeSubscriptionEvents = window.api.services.onSubscriptionEvent((event) => {
      previewFrameRef.current?.contentWindow?.postMessage(
        {
          source: 'artifact-service-subscription-event',
          event
        },
        '*'
      )
    })

    const handleMessage = async (event: MessageEvent) => {
      if (event.source !== previewFrameRef.current?.contentWindow) {
        return
      }

      const data = event.data as {
        source?: string
        kind?: 'invoke-operation' | 'subscribe' | 'unsubscribe'
        requestId?: string
        serviceId?: string
        operationId?: string
        subscriptionId?: string
        input?: Record<string, unknown>
        variables?: Record<string, unknown>
      }

      if (!data || data.source !== 'artifact-service-request' || !data.kind) {
        return
      }

      try {
        if (data.kind === 'invoke-operation') {
          if (!data.requestId || !data.serviceId || !data.operationId) {
            throw new Error('Incomplete artifact service operation request.')
          }

          const result = await window.api.services.invokeOperation(data.serviceId, data.operationId, data.input ?? {})
          previewFrameRef.current?.contentWindow?.postMessage(
            {
              source: 'artifact-service-response',
              requestId: data.requestId,
              result
            },
            '*'
          )
          return
        }

        if (data.kind === 'subscribe') {
          if (!data.requestId || !data.serviceId || !data.operationId) {
            throw new Error('Incomplete artifact service subscription request.')
          }

          const result = await window.api.services.subscribe(data.serviceId, data.operationId, data.variables ?? {})
          previewFrameRef.current?.contentWindow?.postMessage(
            {
              source: 'artifact-service-subscription-ack',
              requestId: data.requestId,
              subscriptionId: result.subscriptionId
            },
            '*'
          )
          return
        }

        if (data.kind === 'unsubscribe') {
          if (!data.subscriptionId) {
            throw new Error('Missing artifact service subscription ID.')
          }

          await window.api.services.unsubscribe(data.subscriptionId)
        }
      } catch (error) {
        previewFrameRef.current?.contentWindow?.postMessage(
          {
            source: data.kind === 'subscribe' ? 'artifact-service-subscription-ack' : 'artifact-service-response',
            requestId: data.requestId,
            error: error instanceof Error ? error.message : String(error)
          },
          '*'
        )
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      disposeSubscriptionEvents()
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  const panelSizes = viewMode === 'split' ? splitSizes : viewMode === 'code' ? ['100%', 0] : [0, '100%']

  const handlePanelResize = useCallback(
    (sizes: number[]) => {
      if (viewMode === 'split') {
        const total = sizes[0] + sizes[1]
        if (total > 0) {
          setSplitSizes([`${(sizes[0] / total) * 100}%`, `${(sizes[1] / total) * 100}%`])
        }
      }
    },
    [viewMode]
  )

  useEffect(() => {
    if (!open || !isFullscreen) return

    const body = document.body
    const originalOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    return () => {
      body.style.overflow = originalOverflow
    }
  }, [isFullscreen, open])

  const handleSave = useCallback(() => {
    codeEditorRef.current?.save?.()
    setSaved(true)
  }, [setSaved])

  const handleSaveToLibrary = useCallback(async () => {
    if (!createLibraryDraft) {
      return
    }

    setSavingToLibrary(true)
    try {
      const source = codeEditorRef.current?.getContent?.() ?? code
      const draft = await createLibraryDraft(source)
      await window.api.artifacts.save(draft)
      window.toast.success(t('settings.artifacts.library.save_success'))
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : t('settings.artifacts.library.save_failed'))
    } finally {
      setSavingToLibrary(false)
    }
  }, [code, createLibraryDraft, t])

  const handleCapture = useCallback(
    async (to: 'file' | 'clipboard') => {
      const fileName = `${title || 'artifact-preview'}`
        .trim()
        .replace(/[^\w.-]+/g, '-')
        .toLowerCase()

      if (to === 'file') {
        const dataUrl = await captureScrollableIframeAsDataURL(previewFrameRef)
        if (dataUrl) {
          void window.api.file.saveImage(fileName, dataUrl)
        }
      }
      if (to === 'clipboard') {
        await captureScrollableIframeAsBlob(previewFrameRef, async (blob) => {
          if (blob) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            window.toast.success(t('message.copy.success'))
          }
        })
      }
    },
    [t, title]
  )

  const renderHeader = () => (
    <ModalHeader onDoubleClick={() => setIsFullscreen(!isFullscreen)} className={classNames({ drag: isFullscreen })}>
      <HeaderLeft $isFullscreen={isFullscreen}>
        <TitleText ellipsis={{ tooltip: true }}>{title}</TitleText>
        <TypeText>{typeLabel}</TypeText>
      </HeaderLeft>

      <HeaderCenter>
        <ViewControls onDoubleClick={(e) => e.stopPropagation()} className="nodrag">
          <ViewButton
            size="small"
            type={viewMode === 'split' ? 'primary' : 'default'}
            icon={<SquareSplitHorizontal size={14} />}
            onClick={() => setViewMode('split')}>
            {t('html_artifacts.split')}
          </ViewButton>
          <ViewButton
            size="small"
            type={viewMode === 'code' ? 'primary' : 'default'}
            icon={<Code size={14} />}
            onClick={() => setViewMode('code')}>
            {t('html_artifacts.code')}
          </ViewButton>
          <ViewButton
            size="small"
            type={viewMode === 'preview' ? 'primary' : 'default'}
            icon={<Eye size={14} />}
            onClick={() => setViewMode('preview')}>
            {t('html_artifacts.preview')}
          </ViewButton>
        </ViewControls>
      </HeaderCenter>

      <HeaderRight onDoubleClick={(e) => e.stopPropagation()}>
        {createLibraryDraft && (
          <Tooltip title={t('settings.artifacts.library.save_action')} mouseLeaveDelay={0}>
            <Button
              type="text"
              icon={<BookMarked size={16} />}
              className="nodrag"
              loading={savingToLibrary}
              onClick={() => void handleSaveToLibrary()}
            />
          </Tooltip>
        )}
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                label: t('html_artifacts.capture.to_file'),
                key: 'capture_to_file',
                icon: <FilePngIcon size={14} className="lucide-custom" />,
                onClick: () => handleCapture('file')
              },
              {
                label: t('html_artifacts.capture.to_clipboard'),
                key: 'capture_to_clipboard',
                icon: <CopyIcon size={14} className="lucide-custom" />,
                onClick: () => handleCapture('clipboard')
              }
            ]
          }}>
          <Tooltip title={t('html_artifacts.capture.label')} mouseLeaveDelay={0}>
            <Button type="text" icon={<Camera size={16} />} className="nodrag" />
          </Tooltip>
        </Dropdown>
        <Button
          onClick={() => setIsFullscreen(!isFullscreen)}
          type="text"
          icon={isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          className="nodrag"
        />
        <Button onClick={onClose} type="text" icon={<X size={16} />} className="nodrag" />
      </HeaderRight>
    </ModalHeader>
  )

  return (
    <StyledModal
      $isFullscreen={isFullscreen}
      title={renderHeader()}
      open={open}
      onCancel={onClose}
      afterClose={onClose}
      centered={!isFullscreen}
      destroyOnHidden
      forceRender={isFullscreen}
      mask={!isFullscreen}
      maskClosable={false}
      width={isFullscreen ? '100vw' : '90vw'}
      style={{
        maxWidth: isFullscreen ? '100vw' : '1400px',
        height: isFullscreen ? '100vh' : 'auto'
      }}
      zIndex={isFullscreen ? 10000 : 1000}
      footer={null}
      closable={false}>
      <Container>
        <Splitter onResize={handlePanelResize}>
          <Splitter.Panel size={panelSizes[0]} min={viewMode === 'split' ? '25%' : 0}>
            <PanelWrapper $hidden={viewMode === 'preview'}>
              <CodePanel
                codeEditorRef={codeEditorRef}
                code={code}
                codeLanguage={codeLanguage}
                onSave={onSave}
                saved={saved}
                onClickSave={handleSave}
                saveLabel={t('code_block.edit.save.label')}
              />
            </PanelWrapper>
          </Splitter.Panel>
          <Splitter.Panel size={panelSizes[1]} min={viewMode === 'split' ? '25%' : 0}>
            <PanelWrapper $hidden={viewMode === 'code'}>
              <PreviewPanel
                previewFrameRef={previewFrameRef}
                previewDocument={previewDocument}
                previewTitle={`${typeLabel} preview`}
                emptyText={t('html_artifacts.empty_preview', 'No content to preview')}
              />
            </PanelWrapper>
          </Splitter.Panel>
        </Splitter>
      </Container>
    </StyledModal>
  )
}

const StyledModal = styled(Modal)<{ $isFullscreen?: boolean }>`
  ${(props) =>
    props.$isFullscreen
      ? `
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

    .ant-modal-body {
      height: calc(100vh - 45px) !important;
    }
  `
      : `
    .ant-modal-body {
      height: 80vh !important;
    }
  `}

  .ant-modal-body {
    padding: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    max-height: initial !important;
  }

  .ant-modal-content {
    border-radius: ${(props) => (props.$isFullscreen ? '0px' : '12px')};
    overflow: hidden;
    height: ${(props) => (props.$isFullscreen ? '100vh' : 'auto')};
    padding: 0 !important;
  }

  .ant-modal-header {
    padding: 10px !important;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-background);
    margin-bottom: 0 !important;
    border-radius: 0 !important;
  }

  ::-webkit-scrollbar {
    width: 8px;
  }
`

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  position: relative;
`

const HeaderLeft = styled.div<{ $isFullscreen?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  padding-left: ${(props) => (props.$isFullscreen && isMac ? '65px' : '12px')};
`

const HeaderCenter = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
`

const HeaderRight = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-right: 12px;
`

const TitleText = styled(Typography.Text)`
  font-size: 16px;
  font-weight: bold;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  width: 50%;
`

const TypeText = styled.span`
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 2px 8px;
`

const ViewControls = styled.div`
  display: flex;
  gap: 8px;
  padding: 4px;
  background: var(--color-background-mute);
  border-radius: 8px;
  border: 1px solid var(--color-border);
  -webkit-app-region: no-drag;
`

const ViewButton = styled(Button)`
  border: none;
  box-shadow: none;

  &.ant-btn-primary {
    background: var(--color-primary);
    color: white;
  }

  &.ant-btn-default {
    background: transparent;
    color: var(--color-text-secondary);

    &:hover {
      background: var(--color-background);
      color: var(--color-text);
    }
  }
`

const Container = styled.div`
  display: flex;
  height: 100%;
  width: 100%;
  flex: 1;
  background: var(--color-background);
  overflow: hidden;
`

const PanelWrapper = styled.div<{ $hidden: boolean }>`
  flex: 1;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  display: ${(props) => (props.$hidden ? 'none' : 'flex')};
`

const CodeSection = styled.div`
  height: 100%;
  width: 100%;
  overflow: hidden;
  position: relative;
  display: grid;
  grid-template-rows: 1fr auto;
`

const PreviewSection = styled.div`
  height: 100%;
  width: 100%;
  background: var(--color-background);
  overflow: hidden;
`

const PreviewFrame = styled.iframe`
  width: 100%;
  height: 100%;
  border: none;
  background: var(--color-background);
`

const EmptyPreview = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background: var(--color-background-soft);
  color: var(--color-text-secondary);
  font-size: 14px;
`

const ToolbarWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  position: absolute;
  gap: 4px;
  right: 1rem;
  bottom: 1rem;
  z-index: 1;
`

const ToolbarButton = styled(Button)`
  border: none;
  box-shadow:
    0 6px 16px 0 rgba(0, 0, 0, 0.08),
    0 3px 6px -4px rgba(0, 0, 0, 0.12),
    0 9px 28px 8px rgba(0, 0, 0, 0.05);
`

export default ArtifactPopup
