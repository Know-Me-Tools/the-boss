import {
  buildHtmlArtifactPreviewDocument,
  buildReactArtifactPreviewDocument,
  getThemeCss,
  parseArtifactDirectiveOverrides
} from '@renderer/artifacts/config'
import ArtifactPopup from '@renderer/components/CodeBlockView/ArtifactPopup'
import { useArtifactLibrary } from '@renderer/hooks/useArtifactLibrary'
import type {
  ArtifactRecord,
  ArtifactRecordDraft,
  ArtifactSettings,
  HtmlArtifactRuntimeProfileId
} from '@shared/artifacts'
import { Button, Input, Modal, Select, Space, Tag } from 'antd'
import { Copy, Eye, GitFork, Pencil, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingDescription, SettingDivider, SettingGroup, SettingTitle } from '..'

function buildCompileErrorDocument(title: string, messages: string[]) {
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

interface Props {
  theme: string
  settings: ArtifactSettings
}

const ArtifactLibrarySection = ({ theme, settings }: Props) => {
  const { t } = useTranslation()
  const { artifacts, loading, search, setSearch, kind, setKind, updateMetadata, forkArtifact, deleteArtifact } =
    useArtifactLibrary()
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactRecord | null>(null)
  const [previewSource, setPreviewSource] = useState('')
  const [previewDocument, setPreviewDocument] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [renamingArtifact, setRenamingArtifact] = useState<ArtifactRecord | null>(null)
  const [renameTitle, setRenameTitle] = useState('')

  const buildPreviewDocument = useCallback(
    async (artifact: ArtifactRecord, source: string) => {
      const artifactSettings: ArtifactSettings = {
        ...settings,
        defaultThemeId: artifact.themeId,
        accessPolicy: artifact.accessPolicy
      }

      if (artifact.kind === 'html') {
        const overrides = parseArtifactDirectiveOverrides('html', source)
        return buildHtmlArtifactPreviewDocument({
          source,
          title: artifact.title,
          runtimeProfileId: artifact.runtimeProfileId as HtmlArtifactRuntimeProfileId,
          settings: artifactSettings,
          overrides
        })
      }

      const overrides = parseArtifactDirectiveOverrides('react', source)
      const result = await window.api.artifacts.compileReact({
        source,
        baseCss: artifactSettings.baseCss,
        themeCss: getThemeCss(artifact.themeId),
        customCss: artifactSettings.customCss,
        title: artifact.title
      })

      if (!result.ok || !result.script) {
        return buildCompileErrorDocument(artifact.title, result.diagnostics)
      }

      return buildReactArtifactPreviewDocument({
        title: artifact.title,
        script: result.script,
        settings: artifactSettings,
        overrides
      })
    },
    [settings]
  )

  const openArtifact = useCallback(
    async (artifact: ArtifactRecord) => {
      setSelectedArtifact(artifact)
      setPreviewSource(artifact.latestSource)
      setPreviewLoading(true)
      try {
        const document = await buildPreviewDocument(artifact, artifact.latestSource)
        setPreviewDocument(document)
      } finally {
        setPreviewLoading(false)
      }
    },
    [buildPreviewDocument]
  )

  const handlePreviewSave = useCallback(
    async (nextSource: string) => {
      if (!selectedArtifact) {
        return
      }

      setPreviewSource(nextSource)
      setPreviewLoading(true)
      try {
        const document = await buildPreviewDocument(selectedArtifact, nextSource)
        setPreviewDocument(document)
      } finally {
        setPreviewLoading(false)
      }
    },
    [buildPreviewDocument, selectedArtifact]
  )

  const handleCopySource = useCallback(
    async (artifact: ArtifactRecord) => {
      await navigator.clipboard.writeText(artifact.latestSource)
      window.toast.success(t('message.copy.success'))
    },
    [t]
  )

  const handleFork = useCallback(
    async (artifact: ArtifactRecord) => {
      await forkArtifact(artifact.id)
      window.toast.success(t('settings.artifacts.library.fork_success'))
    },
    [forkArtifact, t]
  )

  const handleDelete = useCallback(
    async (artifact: ArtifactRecord) => {
      await deleteArtifact(artifact.id)
      if (selectedArtifact?.id === artifact.id) {
        setSelectedArtifact(null)
        setPreviewSource('')
        setPreviewDocument('')
      }
      window.toast.success(t('settings.artifacts.library.delete_success'))
    },
    [deleteArtifact, selectedArtifact, t]
  )

  const libraryRows = useMemo(() => {
    return artifacts.map((artifact) => (
      <LibraryRow key={artifact.id}>
        <LibraryMeta>
          <LibraryTitle>{artifact.title}</LibraryTitle>
          <LibraryDetails>
            <Tag>{artifact.kind}</Tag>
            <Tag>{artifact.sourceLanguage}</Tag>
            <Tag>{artifact.runtimeProfileId}</Tag>
            <span>{t('settings.artifacts.library.versions', { count: artifact.versions.length })}</span>
            <span>{new Date(artifact.updatedAt).toLocaleString()}</span>
          </LibraryDetails>
        </LibraryMeta>
        <LibraryActions>
          <Button size="small" icon={<Eye size={14} />} onClick={() => void openArtifact(artifact)}>
            {t('common.open')}
          </Button>
          <Button size="small" icon={<Copy size={14} />} onClick={() => void handleCopySource(artifact)}>
            {t('common.copy')}
          </Button>
          <Button size="small" icon={<GitFork size={14} />} onClick={() => void handleFork(artifact)}>
            {t('settings.artifacts.library.fork_action')}
          </Button>
          <Button
            size="small"
            icon={<Pencil size={14} />}
            onClick={() => {
              setRenamingArtifact(artifact)
              setRenameTitle(artifact.title)
            }}>
            {t('common.rename')}
          </Button>
          <Button size="small" danger icon={<Trash2 size={14} />} onClick={() => void handleDelete(artifact)}>
            {t('common.delete')}
          </Button>
        </LibraryActions>
      </LibraryRow>
    ))
  }, [artifacts, handleCopySource, handleDelete, handleFork, openArtifact, t])

  return (
    <>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.artifacts.library.title')}</SettingTitle>
        <SettingDescription>{t('settings.artifacts.library.description')}</SettingDescription>
        <SettingDivider />
        <SearchRow>
          <Input
            value={search}
            placeholder={t('settings.artifacts.library.search_placeholder')}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            value={kind}
            style={{ width: 180 }}
            options={[
              { label: t('settings.artifacts.library.filter_all'), value: 'all' },
              { label: t('settings.artifacts.library.filter_html'), value: 'html' },
              { label: t('settings.artifacts.library.filter_react'), value: 'react' }
            ]}
            onChange={(value) => setKind(value)}
          />
        </SearchRow>
        <SettingDivider />
        {loading ? (
          <SettingDescription>{t('common.loading')}</SettingDescription>
        ) : artifacts.length === 0 ? (
          <SettingDescription>{t('settings.artifacts.library.empty')}</SettingDescription>
        ) : (
          <LibraryList>{libraryRows}</LibraryList>
        )}
      </SettingGroup>

      <Modal
        open={!!renamingArtifact}
        title={t('common.rename')}
        okText={t('common.save')}
        onOk={async () => {
          if (!renamingArtifact || !renameTitle.trim()) {
            return
          }

          await updateMetadata(renamingArtifact.id, { title: renameTitle.trim() })
          window.toast.success(t('settings.artifacts.library.rename_success'))
          setRenamingArtifact(null)
        }}
        onCancel={() => setRenamingArtifact(null)}
        destroyOnClose>
        <Input value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} />
      </Modal>

      {selectedArtifact && (
        <ArtifactPopup
          open={!!selectedArtifact}
          title={selectedArtifact.title}
          code={previewSource}
          codeLanguage={selectedArtifact.kind === 'html' ? 'html' : 'tsx'}
          previewKind={selectedArtifact.kind}
          typeLabel={selectedArtifact.kind === 'html' ? 'HTML Artifact' : 'React/TSX Artifact'}
          previewDocument={
            previewLoading
              ? `<!doctype html><html><body style="margin:0;padding:24px;font-family:system-ui;background:#0f172a;color:#e2e8f0;">${t('settings.artifacts.library.preview_loading')}</body></html>`
              : previewDocument
          }
          previewThemeId={selectedArtifact.themeId}
          previewAccessPolicy={selectedArtifact.accessPolicy}
          onSave={(source) => {
            void handlePreviewSave(source)
          }}
          createLibraryDraft={async (source): Promise<ArtifactRecordDraft> => {
            return {
              title: selectedArtifact.title,
              kind: selectedArtifact.kind,
              runtimeProfileId: selectedArtifact.runtimeProfileId,
              sourceLanguage: selectedArtifact.sourceLanguage,
              source,
              themeId: selectedArtifact.themeId,
              accessPolicy: selectedArtifact.accessPolicy,
              origin: selectedArtifact.origin
            }
          }}
          onClose={() => {
            setSelectedArtifact(null)
            setPreviewSource('')
            setPreviewDocument('')
          }}
        />
      )}
    </>
  )
}

const SearchRow = styled.div`
  display: flex;
  gap: 12px;
`

const LibraryList = styled.div`
  display: flex;
  flex-direction: column;
`

const LibraryRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
`

const LibraryMeta = styled.div`
  min-width: 0;
`

const LibraryTitle = styled.div`
  font-weight: 600;
  color: var(--color-text-1);
`

const LibraryDetails = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--color-text-3);
  font-size: 12px;
  margin-top: 6px;
`

const LibraryActions = styled(Space)`
  flex-wrap: wrap;
  justify-content: flex-end;
`

export default ArtifactLibrarySection
