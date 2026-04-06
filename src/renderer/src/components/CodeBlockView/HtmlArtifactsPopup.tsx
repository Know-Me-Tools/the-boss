import type { ArtifactAccessPolicy, ArtifactRecordDraft, ArtifactThemeId } from '@shared/artifacts'

import ArtifactPopup from './ArtifactPopup'

interface HtmlArtifactsPopupProps {
  open: boolean
  title: string
  html: string
  previewDocument?: string
  previewThemeId?: ArtifactThemeId
  previewAccessPolicy?: ArtifactAccessPolicy
  onSave?: (html: string) => void
  createLibraryDraft?: (source: string) => Promise<ArtifactRecordDraft>
  onClose: () => void
}

const HtmlArtifactsPopup = ({
  open,
  title,
  html,
  previewDocument,
  previewThemeId,
  previewAccessPolicy,
  onSave,
  createLibraryDraft,
  onClose
}: HtmlArtifactsPopupProps) => {
  return (
    <ArtifactPopup
      open={open}
      title={title}
      code={html}
      codeLanguage="html"
      previewKind="html"
      typeLabel="HTML Artifact"
      previewDocument={previewDocument ?? html}
      previewThemeId={previewThemeId}
      previewAccessPolicy={previewAccessPolicy}
      onSave={onSave}
      createLibraryDraft={createLibraryDraft}
      onClose={onClose}
    />
  )
}

export default HtmlArtifactsPopup
