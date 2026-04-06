import type { ArtifactRecordDraft } from '@shared/artifacts'

import ArtifactPopup from './ArtifactPopup'

interface HtmlArtifactsPopupProps {
  open: boolean
  title: string
  html: string
  previewDocument?: string
  onSave?: (html: string) => void
  createLibraryDraft?: (source: string) => Promise<ArtifactRecordDraft>
  onClose: () => void
}

const HtmlArtifactsPopup = ({
  open,
  title,
  html,
  previewDocument,
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
      typeLabel="HTML Artifact"
      previewDocument={previewDocument ?? html}
      onSave={onSave}
      createLibraryDraft={createLibraryDraft}
      onClose={onClose}
    />
  )
}

export default HtmlArtifactsPopup
