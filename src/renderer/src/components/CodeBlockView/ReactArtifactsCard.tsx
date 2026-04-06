import { CodeOutlined } from '@ant-design/icons'
import {
  buildReactArtifactPreviewDocument,
  getThemeCss,
  loadArtifactSettings,
  parseArtifactDirectiveOverrides
} from '@renderer/artifacts/config'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { ThemeMode } from '@renderer/types'
import type { ArtifactOriginRef, ArtifactSourceLanguage, ReactArtifactRuntimeProfileId } from '@shared/artifacts'
import { Button } from 'antd'
import { Atom, DownloadIcon, LinkIcon, Sparkles } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipLoader } from 'react-spinners'
import styled, { keyframes } from 'styled-components'

import ArtifactPopup from './ArtifactPopup'

interface Props {
  code: string
  runtimeProfileId?: ReactArtifactRuntimeProfileId
  sourceLanguage?: Extract<ArtifactSourceLanguage, 'tsx' | 'jsx'>
  origin?: ArtifactOriginRef
  onSave?: (code: string) => void
  isStreaming?: boolean
}

const getTerminalStyles = (theme: ThemeMode) => ({
  background: theme === 'dark' ? '#1e1e1e' : '#f0f0f0',
  color: theme === 'dark' ? '#cccccc' : '#333333',
  promptColor: theme === 'dark' ? '#7dd3fc' : '#0369a1'
})

function getReactArtifactTitle(source: string): string {
  const componentName = /export\s+default\s+function\s+([A-Za-z0-9_]+)/.exec(source)?.[1]
  if (componentName) {
    return componentName
  }

  const constName = /export\s+default\s+([A-Za-z0-9_]+)/.exec(source)?.[1]
  if (constName) {
    return constName
  }

  return 'React/TSX Artifact'
}

function buildCompileErrorDocument(title: string, messages: string[]): string {
  const content = messages
    .map((message) => message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
    .join('\n')

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          body {
            margin: 0;
            padding: 24px;
            font-family:
              "SFMono-Regular",
              "JetBrains Mono",
              ui-monospace,
              Menlo,
              monospace;
            background: #0f172a;
            color: #fda4af;
          }
          pre {
            white-space: pre-wrap;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <pre>${content}</pre>
      </body>
    </html>`
}

const ReactArtifactsCard: FC<Props> = ({
  code,
  runtimeProfileId = 'react-default',
  sourceLanguage = 'tsx',
  origin,
  onSave,
  isStreaming = false
}) => {
  const { t } = useTranslation()
  const title = useMemo(() => getReactArtifactTitle(code), [code])
  const [isPopupOpen, setIsPopupOpen] = useState(false)
  const [isCompiling, setIsCompiling] = useState(false)
  const [previewDocument, setPreviewDocument] = useState('')
  const { theme } = useTheme()

  const sourceCode = code || ''
  const hasContent = sourceCode.trim().length > 0

  const compilePreview = useCallback(async (): Promise<string> => {
    setIsCompiling(true)

    try {
      const settings = await loadArtifactSettings()
      const overrides = parseArtifactDirectiveOverrides('react', sourceCode)
      const themeId = overrides.themeId ?? settings.defaultThemeId
      const result = await window.api.artifacts.compileReact({
        source: sourceCode,
        baseCss: settings.baseCss,
        themeCss: getThemeCss(themeId),
        customCss: settings.customCss,
        title
      })

      if (!result.ok || !result.script) {
        const errorDocument = buildCompileErrorDocument(title, result.diagnostics)
        setPreviewDocument(errorDocument)
        return errorDocument
      }

      const document = buildReactArtifactPreviewDocument({
        title,
        script: result.script,
        settings,
        overrides
      })
      setPreviewDocument(document)
      return document
    } finally {
      setIsCompiling(false)
    }
  }, [sourceCode, title])

  useEffect(() => {
    if (!isPopupOpen || !hasContent) {
      return
    }

    void compilePreview()
  }, [compilePreview, hasContent, isPopupOpen])

  const handleOpenExternal = useCallback(async () => {
    const document = previewDocument || (await compilePreview())
    const path = await window.api.file.createTempFile('react-artifact-preview.html')
    await window.api.file.write(path, document)
    void window.api.shell.openExternal(`file://${path}`)
  }, [compilePreview, previewDocument])

  const handleDownload = async () => {
    await window.api.file.save(`${title.replace(/[^\w.-]+/g, '-').toLowerCase() || 'react-artifact'}.tsx`, sourceCode)
    window.toast.success(t('message.download.success'))
  }

  const loadingDocument = `<!doctype html><html><body style="margin:0;padding:24px;font-family:system-ui;background:#0f172a;color:#e2e8f0;">${t('settings.artifacts.react_compiling')}</body></html>`

  return (
    <>
      <Container $isStreaming={isStreaming}>
        <Header>
          <IconWrapper $isStreaming={isStreaming}>
            {isStreaming ? <Sparkles size={20} color="white" /> : <Atom size={20} color="white" />}
          </IconWrapper>
          <TitleSection>
            <Title>{title}</Title>
            <TypeBadge>
              <Atom size={12} />
              <span>React/TSX</span>
            </TypeBadge>
          </TitleSection>
        </Header>
        <Content>
          {(isStreaming && !hasContent) || isCompiling ? (
            <GeneratingContainer>
              <ClipLoader size={20} color="var(--color-primary)" />
              <GeneratingText>
                {isCompiling
                  ? t('settings.artifacts.react_compiling')
                  : t('html_artifacts.generating', 'Generating content...')}
              </GeneratingText>
            </GeneratingContainer>
          ) : isStreaming && hasContent ? (
            <>
              <TerminalPreview $theme={theme}>
                <TerminalContent $theme={theme}>
                  <TerminalLine>
                    <TerminalPrompt $theme={theme}>tsx</TerminalPrompt>
                    <TerminalCodeLine $theme={theme}>
                      {sourceCode.trim().split('\n').slice(-4).join('\n')}
                      <TerminalCursor $theme={theme} />
                    </TerminalCodeLine>
                  </TerminalLine>
                </TerminalContent>
              </TerminalPreview>
              <ButtonContainer>
                <Button icon={<CodeOutlined />} onClick={() => setIsPopupOpen(true)} type="primary">
                  {t('chat.artifacts.button.preview')}
                </Button>
              </ButtonContainer>
            </>
          ) : (
            <ButtonContainer>
              <Button icon={<CodeOutlined />} onClick={() => setIsPopupOpen(true)} type="text" disabled={!hasContent}>
                {t('chat.artifacts.button.preview')}
              </Button>
              <Button icon={<LinkIcon size={14} />} onClick={handleOpenExternal} type="text" disabled={!hasContent}>
                {t('chat.artifacts.button.openExternal')}
              </Button>
              <Button icon={<DownloadIcon size={14} />} onClick={handleDownload} type="text" disabled={!hasContent}>
                {t('code_block.download.label')}
              </Button>
            </ButtonContainer>
          )}
        </Content>
      </Container>

      <ArtifactPopup
        open={isPopupOpen}
        title={title}
        code={sourceCode}
        codeLanguage="tsx"
        typeLabel="React/TSX Artifact"
        previewDocument={previewDocument || loadingDocument}
        createLibraryDraft={async (source) => {
          const settings = await loadArtifactSettings()
          const overrides = parseArtifactDirectiveOverrides('react', source)

          return {
            title: getReactArtifactTitle(source),
            kind: 'react',
            runtimeProfileId,
            sourceLanguage,
            source,
            themeId: overrides.themeId ?? settings.defaultThemeId,
            accessPolicy: {
              internetEnabled: overrides.internetEnabled ?? settings.accessPolicy.internetEnabled,
              serviceIds: overrides.serviceIds ?? settings.accessPolicy.serviceIds
            },
            origin
          }
        }}
        onSave={onSave}
        onClose={() => setIsPopupOpen(false)}
      />
    </>
  )
}

const Container = styled.div<{ $isStreaming: boolean }>`
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  margin: 10px 0;
  margin-top: 0;
`

const GeneratingContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 20px;
  min-height: 78px;
`

const GeneratingText = styled.div`
  font-size: 14px;
  color: var(--color-text-secondary);
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 24px 16px;
  background: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
  border-radius: 8px 8px 0 0;
`

const IconWrapper = styled.div<{ $isStreaming: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  background: ${(props) =>
    props.$isStreaming
      ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
      : 'linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)'};
  border-radius: 12px;
  color: white;
  box-shadow: ${(props) =>
    props.$isStreaming ? '0 4px 6px -1px rgba(245, 158, 11, 0.3)' : '0 4px 6px -1px rgba(20, 184, 166, 0.3)'};
  transition: background 0.3s ease;
`

const TitleSection = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const Title = styled.span`
  font-size: 14px;
  font-weight: bold;
  color: var(--color-text-1);
  line-height: 1.4;
  font-family: var(--font-family-display);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
`

const TypeBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  background: var(--color-background-mute);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 10px;
  font-weight: 500;
  color: var(--color-text-secondary);
  width: fit-content;
`

const Content = styled.div`
  padding: 0;
  background: var(--color-background);
`

const ButtonContainer = styled.div`
  margin: 10px 16px !important;
  display: flex;
  flex-direction: row;
`

const TerminalPreview = styled.div<{ $theme: ThemeMode }>`
  margin: 16px;
  background: ${(props) => getTerminalStyles(props.$theme).background};
  border-radius: 8px;
  overflow: hidden;
  font-family: var(--code-font-family);
`

const TerminalContent = styled.div<{ $theme: ThemeMode }>`
  padding: 12px;
  background: ${(props) => getTerminalStyles(props.$theme).background};
  color: ${(props) => getTerminalStyles(props.$theme).color};
  font-size: 13px;
  line-height: 1.4;
  min-height: 80px;
`

const TerminalLine = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
`

const TerminalCodeLine = styled.span<{ $theme: ThemeMode }>`
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${(props) => getTerminalStyles(props.$theme).color};
  background-color: transparent !important;
`

const TerminalPrompt = styled.span<{ $theme: ThemeMode }>`
  color: ${(props) => getTerminalStyles(props.$theme).promptColor};
  font-weight: bold;
  flex-shrink: 0;
`

const blinkAnimation = keyframes`
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
`

const TerminalCursor = styled.span<{ $theme: ThemeMode }>`
  display: inline-block;
  width: 7px;
  height: 14px;
  background: ${(props) => getTerminalStyles(props.$theme).promptColor};
  margin-left: 2px;
  vertical-align: middle;
  animation: ${blinkAnimation} 1s infinite;
`

export default ReactArtifactsCard
