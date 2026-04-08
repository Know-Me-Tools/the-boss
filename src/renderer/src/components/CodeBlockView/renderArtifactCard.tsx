import type { ArtifactOriginRef } from '@shared/artifacts'
import { getDefaultArtifactSettings, parseArtifactLanguage } from '@shared/artifacts'
import type { ReactNode } from 'react'

import HtmlArtifactsCard from './HtmlArtifactsCard'
import ReactArtifactsCard from './ReactArtifactsCard'

const defaultArtifactSettings = getDefaultArtifactSettings()

interface ResolveArtifactDescriptorOptions {
  language?: string | null
  filePath?: string
  source: string
  defaults?: Partial<
    Pick<typeof defaultArtifactSettings, 'defaultHtmlRuntimeProfileId' | 'defaultReactRuntimeProfileId'>
  >
}

interface RenderArtifactCardOptions extends ResolveArtifactDescriptorOptions {
  origin?: ArtifactOriginRef
  onSave?: (source: string) => void
  isStreaming?: boolean
}

function getArtifactLanguageHint(filePath?: string): string | null {
  if (!filePath) {
    return null
  }

  const normalizedPath = filePath.toLowerCase()

  if (normalizedPath.endsWith('.tsx')) {
    return 'tsx-artifact'
  }

  if (normalizedPath.endsWith('.jsx')) {
    return 'jsx-artifact'
  }

  if (normalizedPath.endsWith('.html') || normalizedPath.endsWith('.htm')) {
    return 'html'
  }

  return null
}

export function resolveArtifactDescriptor({ language, filePath, source, defaults }: ResolveArtifactDescriptorOptions) {
  const languageHint = language ?? getArtifactLanguageHint(filePath)

  return parseArtifactLanguage(
    languageHint,
    {
      defaultHtmlRuntimeProfileId:
        defaults?.defaultHtmlRuntimeProfileId ?? defaultArtifactSettings.defaultHtmlRuntimeProfileId,
      defaultReactRuntimeProfileId:
        defaults?.defaultReactRuntimeProfileId ?? defaultArtifactSettings.defaultReactRuntimeProfileId
    },
    source
  )
}

export function renderArtifactCard({
  language,
  filePath,
  source,
  defaults,
  origin,
  onSave,
  isStreaming = false
}: RenderArtifactCardOptions): ReactNode | null {
  const artifactDescriptor = resolveArtifactDescriptor({ language, filePath, source, defaults })

  if (!artifactDescriptor) {
    return null
  }

  if (artifactDescriptor.kind === 'html') {
    return (
      <HtmlArtifactsCard
        html={source}
        runtimeProfileId={artifactDescriptor.runtimeProfileId}
        typeLabel={artifactDescriptor.displayType}
        origin={origin}
        onSave={onSave}
        isStreaming={isStreaming}
      />
    )
  }

  return (
    <ReactArtifactsCard
      code={source}
      runtimeProfileId={artifactDescriptor.runtimeProfileId}
      sourceLanguage={artifactDescriptor.sourceLanguage}
      origin={origin}
      onSave={onSave}
      isStreaming={isStreaming}
    />
  )
}
