import * as z from 'zod'

export const ARTIFACTS_CONFIG_KEY = 'artifacts.settings'

export const ArtifactKindSchema = z.enum(['html', 'react'])
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>

export const HtmlArtifactRuntimeProfileIdSchema = z.enum(['html', 'html+alpine', 'html+htmx', 'html+htmx+alpine'])
export type HtmlArtifactRuntimeProfileId = z.infer<typeof HtmlArtifactRuntimeProfileIdSchema>

export const ReactArtifactRuntimeProfileIdSchema = z.enum(['react-default'])
export type ReactArtifactRuntimeProfileId = z.infer<typeof ReactArtifactRuntimeProfileIdSchema>

export const ArtifactRuntimeProfileIdSchema = z.union([
  HtmlArtifactRuntimeProfileIdSchema,
  ReactArtifactRuntimeProfileIdSchema
])
export type ArtifactRuntimeProfileId = z.infer<typeof ArtifactRuntimeProfileIdSchema>

export const ArtifactThemeIdSchema = z.enum(['boss-light', 'boss-dark', 'ocean'])
export type ArtifactThemeId = z.infer<typeof ArtifactThemeIdSchema>

export const ArtifactPackageRegistryKindSchema = z.enum(['html-library', 'react-library', 'react-component'])
export type ArtifactPackageRegistryKind = z.infer<typeof ArtifactPackageRegistryKindSchema>

export const ArtifactSourceLanguageSchema = z.enum(['html', 'tsx', 'jsx'])
export type ArtifactSourceLanguage = z.infer<typeof ArtifactSourceLanguageSchema>

export const HtmlArtifactRuntimeProfileSchema = z.object({
  id: HtmlArtifactRuntimeProfileIdSchema,
  kind: z.literal('html'),
  label: z.string(),
  description: z.string(),
  libraries: z.array(z.string()).default([])
})
export type HtmlArtifactRuntimeProfile = z.infer<typeof HtmlArtifactRuntimeProfileSchema>

export const ReactArtifactRuntimeProfileSchema = z.object({
  id: ReactArtifactRuntimeProfileIdSchema,
  kind: z.literal('react'),
  label: z.string(),
  description: z.string()
})
export type ReactArtifactRuntimeProfile = z.infer<typeof ReactArtifactRuntimeProfileSchema>

export const ArtifactThemePresetSchema = z.object({
  id: ArtifactThemeIdSchema,
  label: z.string(),
  description: z.string()
})
export type ArtifactThemePreset = z.infer<typeof ArtifactThemePresetSchema>

export const ArtifactPackageRegistryEntrySchema = z.object({
  id: z.string(),
  kind: ArtifactPackageRegistryKindSchema,
  packageName: z.string(),
  version: z.string(),
  description: z.string(),
  runtimeKinds: z.array(ArtifactKindSchema)
})
export type ArtifactPackageRegistryEntry = z.infer<typeof ArtifactPackageRegistryEntrySchema>

export const ArtifactAccessPolicySchema = z.object({
  internetEnabled: z.boolean().default(true),
  serviceIds: z.array(z.string()).default([]),
  serviceToolIds: z.array(z.string()).default([])
})
export type ArtifactAccessPolicy = z.infer<typeof ArtifactAccessPolicySchema>

export const ArtifactOriginRefSchema = z.object({
  messageBlockId: z.string().optional(),
  codeBlockId: z.string().optional()
})
export type ArtifactOriginRef = z.infer<typeof ArtifactOriginRefSchema>

export const ArtifactA2UIExportMetadataSchema = z.object({
  status: z.enum(['not-exported', 'ready']).default('not-exported'),
  schemaVersion: z.string().default('a2ui-draft'),
  componentId: z.string().optional(),
  updatedAt: z.string().optional()
})
export type ArtifactA2UIExportMetadata = z.infer<typeof ArtifactA2UIExportMetadataSchema>

export const ArtifactVersionSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  source: z.string().min(1),
  sourceLanguage: ArtifactSourceLanguageSchema,
  runtimeProfileId: ArtifactRuntimeProfileIdSchema,
  themeId: ArtifactThemeIdSchema,
  accessPolicy: ArtifactAccessPolicySchema,
  origin: ArtifactOriginRefSchema.optional()
})
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>

export const ArtifactRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: ArtifactKindSchema,
  runtimeProfileId: ArtifactRuntimeProfileIdSchema,
  sourceLanguage: ArtifactSourceLanguageSchema,
  latestSource: z.string().min(1),
  themeId: ArtifactThemeIdSchema,
  accessPolicy: ArtifactAccessPolicySchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  currentVersionId: z.string().min(1),
  versions: z.array(ArtifactVersionSchema).min(1),
  origin: ArtifactOriginRefSchema.optional(),
  sourceArtifactId: z.string().optional(),
  exportMetadata: ArtifactA2UIExportMetadataSchema.default({
    status: 'not-exported',
    schemaVersion: 'a2ui-draft'
  })
})
export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>

export const ArtifactRecordDraftSchema = z.object({
  title: z.string().min(1),
  kind: ArtifactKindSchema,
  runtimeProfileId: ArtifactRuntimeProfileIdSchema,
  sourceLanguage: ArtifactSourceLanguageSchema,
  source: z.string().min(1),
  themeId: ArtifactThemeIdSchema,
  accessPolicy: ArtifactAccessPolicySchema,
  origin: ArtifactOriginRefSchema.optional()
})
export type ArtifactRecordDraft = z.infer<typeof ArtifactRecordDraftSchema>

export const ArtifactLibraryQuerySchema = z.object({
  search: z.string().optional(),
  kind: ArtifactKindSchema.optional()
})
export type ArtifactLibraryQuery = z.infer<typeof ArtifactLibraryQuerySchema>

export const ArtifactMetadataPatchSchema = z.object({
  title: z.string().min(1).optional()
})
export type ArtifactMetadataPatch = z.infer<typeof ArtifactMetadataPatchSchema>

export const ArtifactLibraryFileSchema = z.object({
  version: z.literal(1).default(1),
  artifacts: z.array(ArtifactRecordSchema).default([])
})
export type ArtifactLibraryFile = z.infer<typeof ArtifactLibraryFileSchema>

export const ArtifactSettingsSchema = z.object({
  defaultHtmlRuntimeProfileId: HtmlArtifactRuntimeProfileIdSchema.default('html'),
  defaultReactRuntimeProfileId: ReactArtifactRuntimeProfileIdSchema.default('react-default'),
  defaultThemeId: ArtifactThemeIdSchema.default('boss-light'),
  accessPolicy: ArtifactAccessPolicySchema.default({
    internetEnabled: true,
    serviceIds: [],
    serviceToolIds: []
  }),
  exposePackageRegistry: z.boolean().default(true),
  baseCss: z.string().default(''),
  customCss: z.string().default('')
})
export type ArtifactSettings = z.infer<typeof ArtifactSettingsSchema>

export const ArtifactDirectiveOverridesSchema = z.object({
  themeId: ArtifactThemeIdSchema.optional(),
  internetEnabled: z.boolean().optional(),
  serviceIds: z.array(z.string()).optional(),
  serviceToolIds: z.array(z.string()).optional()
})
export type ArtifactDirectiveOverrides = z.infer<typeof ArtifactDirectiveOverridesSchema>

export const CompileReactArtifactRequestSchema = z.object({
  source: z.string().min(1),
  baseCss: z.string().default(''),
  themeCss: z.string().default(''),
  customCss: z.string().default(''),
  title: z.string().default('React Artifact')
})
export type CompileReactArtifactRequest = z.infer<typeof CompileReactArtifactRequestSchema>

export const CompileReactArtifactResponseSchema = z.object({
  ok: z.boolean(),
  script: z.string().default(''),
  diagnostics: z.array(z.string()).default([])
})
export type CompileReactArtifactResponse = z.infer<typeof CompileReactArtifactResponseSchema>

export const SaveArtifactRequestSchema = ArtifactRecordDraftSchema
export type SaveArtifactRequest = z.infer<typeof SaveArtifactRequestSchema>

export const ListArtifactsRequestSchema = ArtifactLibraryQuerySchema.default({})
export type ListArtifactsRequest = z.infer<typeof ListArtifactsRequestSchema>

export const UpdateArtifactMetadataRequestSchema = z.object({
  id: z.string().min(1),
  patch: ArtifactMetadataPatchSchema
})
export type UpdateArtifactMetadataRequest = z.infer<typeof UpdateArtifactMetadataRequestSchema>

export const HTML_ARTIFACT_RUNTIME_PROFILES: HtmlArtifactRuntimeProfile[] = [
  {
    id: 'html',
    kind: 'html',
    label: 'Plain HTML',
    description: 'Render raw HTML with the shared artifact CSS and access policy.',
    libraries: []
  },
  {
    id: 'html+alpine',
    kind: 'html',
    label: 'HTML + Alpine',
    description: 'Render HTML with Alpine.js loaded into the artifact frame.',
    libraries: ['alpinejs']
  },
  {
    id: 'html+htmx',
    kind: 'html',
    label: 'HTML + htmx',
    description: 'Render HTML with htmx loaded into the artifact frame.',
    libraries: ['htmx']
  },
  {
    id: 'html+htmx+alpine',
    kind: 'html',
    label: 'HTML + htmx + Alpine',
    description: 'Render HTML with htmx and Alpine.js loaded into the artifact frame.',
    libraries: ['htmx', 'alpinejs']
  }
]

export const REACT_ARTIFACT_RUNTIME_PROFILES: ReactArtifactRuntimeProfile[] = [
  {
    id: 'react-default',
    kind: 'react',
    label: 'React/TSX + Shadow DOM',
    description: 'Compile React/TSX locally and mount it inside a shadow root within a sandboxed frame.'
  }
]

export const ARTIFACT_THEME_PRESETS: ArtifactThemePreset[] = [
  {
    id: 'boss-light',
    label: 'Boss Light',
    description: 'Neutral light theme using The Boss surface tokens.'
  },
  {
    id: 'boss-dark',
    label: 'Boss Dark',
    description: 'Neutral dark theme using The Boss surface tokens.'
  },
  {
    id: 'ocean',
    label: 'Ocean',
    description: 'Blue-green accent theme for more branded artifact previews.'
  }
]

export const ARTIFACT_PACKAGE_REGISTRY: ArtifactPackageRegistryEntry[] = [
  {
    id: 'html-htmx',
    kind: 'html-library',
    packageName: 'htmx.org',
    version: '2.0.8',
    description: 'Pinned htmx runtime available to enhanced HTML artifacts.',
    runtimeKinds: ['html']
  },
  {
    id: 'html-alpine',
    kind: 'html-library',
    packageName: 'alpinejs',
    version: '3.15.0',
    description: 'Pinned Alpine.js runtime available to enhanced HTML artifacts.',
    runtimeKinds: ['html']
  },
  {
    id: 'react-core',
    kind: 'react-library',
    packageName: 'react',
    version: '19.2.0',
    description: 'Core React runtime bundled locally for React/TSX artifacts.',
    runtimeKinds: ['react']
  },
  {
    id: 'react-dom-core',
    kind: 'react-library',
    packageName: 'react-dom',
    version: '19.2.0',
    description: 'React DOM client runtime bundled locally for React/TSX artifacts.',
    runtimeKinds: ['react']
  },
  {
    id: 'react-lucide',
    kind: 'react-library',
    packageName: 'lucide-react',
    version: '0.525.0',
    description: 'Approved icon package for React artifacts.',
    runtimeKinds: ['react']
  },
  {
    id: 'react-clsx',
    kind: 'react-library',
    packageName: 'clsx',
    version: '2.1.1',
    description: 'Approved class name utility for React artifacts.',
    runtimeKinds: ['react']
  },
  {
    id: 'react-tailwind-merge',
    kind: 'react-library',
    packageName: 'tailwind-merge',
    version: '3.3.1',
    description: 'Approved Tailwind merge utility for React artifacts.',
    runtimeKinds: ['react']
  },
  {
    id: 'react-artifact-button',
    kind: 'react-component',
    packageName: '@artifact-ui/button',
    version: 'registry',
    description: 'Managed button component inspired by shadcn/ui.',
    runtimeKinds: ['react']
  },
  {
    id: 'react-artifact-card',
    kind: 'react-component',
    packageName: '@artifact-ui/card',
    version: 'registry',
    description: 'Managed card component inspired by shadcn/ui.',
    runtimeKinds: ['react']
  },
  {
    id: 'react-artifact-badge',
    kind: 'react-component',
    packageName: '@artifact-ui/badge',
    version: 'registry',
    description: 'Managed badge component inspired by shadcn/ui.',
    runtimeKinds: ['react']
  },
  {
    id: 'react-artifact-input',
    kind: 'react-component',
    packageName: '@artifact-ui/input',
    version: 'registry',
    description: 'Managed input component inspired by shadcn/ui.',
    runtimeKinds: ['react']
  }
]

export type ArtifactLanguageDescriptor =
  | {
      kind: 'html'
      runtimeProfileId: HtmlArtifactRuntimeProfileId
      displayType: string
      editorLanguage: 'html'
      sourceLanguage: 'html'
    }
  | {
      kind: 'react'
      runtimeProfileId: ReactArtifactRuntimeProfileId
      displayType: 'React/TSX Artifact'
      editorLanguage: 'tsx'
      sourceLanguage: 'tsx' | 'jsx'
    }

const REACT_ARTIFACT_LANGUAGE_ALIASES = new Set(['react', 'tsx-artifact', 'react-tsx', 'react+tsx', 'typescript-react'])
const LEGACY_REACT_ARTIFACT_LANGUAGE_ALIASES = new Set(['jsx-artifact'])
const HTML_HTMX_ARTIFACT_LANGUAGE_ALIASES = new Set(['htmx', 'htmx-artifact', 'html-htmx', 'htmx-html'])
const HTML_ALPINE_ARTIFACT_LANGUAGE_ALIASES = new Set(['alpine', 'alpinejs', 'alpine-artifact', 'html-alpine'])
const HTML_HTMX_ALPINE_ARTIFACT_LANGUAGE_ALIASES = new Set([
  'htmx+alpine',
  'alpine+htmx',
  'htmx+alpinejs',
  'alpinejs+htmx',
  'html-htmx-alpine',
  'html-alpine-htmx'
])

function looksLikeHtmlDocument(source: string | undefined): boolean {
  if (!source) {
    return false
  }

  const trimmed = source.trim()

  return /^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(trimmed)
}

function looksLikeReactArtifactSource(source: string | undefined): boolean {
  if (!source || looksLikeHtmlDocument(source)) {
    return false
  }

  const hasReactImport =
    /\bfrom\s+['"]react['"]/.test(source) ||
    /\brequire\(\s*['"]react['"]\s*\)/.test(source) ||
    /\bfrom\s+['"]react-dom(?:\/client)?['"]/.test(source)
  const hasModuleSyntax = /^\s*import\s.+from\s+['"][^'"]+['"]/m.test(source) || /^\s*export\s+default\b/m.test(source)
  const hasTypeScriptDeclarations = /\btype\s+[A-Z]\w*\s*=/.test(source) || /\binterface\s+[A-Z]\w*\s*{/.test(source)
  const hasJsx =
    /return\s*\(\s*<[\w]/.test(source) ||
    /return\s+<[\w]/.test(source) ||
    /=>\s*<[\w]/.test(source) ||
    /<[A-Za-z][A-Za-z0-9_.-]*(?:\s|>)/.test(source) ||
    /<>\s*/.test(source)

  return hasJsx && (hasReactImport || hasModuleSyntax || hasTypeScriptDeclarations)
}

function detectHtmlRuntimeProfileId(
  normalizedLanguage: string,
  source: string | undefined,
  defaults?: Pick<ArtifactSettings, 'defaultHtmlRuntimeProfileId'>
): HtmlArtifactRuntimeProfileId | null {
  const hasHtmxMarkers =
    HTML_HTMX_ARTIFACT_LANGUAGE_ALIASES.has(normalizedLanguage) ||
    HTML_HTMX_ALPINE_ARTIFACT_LANGUAGE_ALIASES.has(normalizedLanguage) ||
    /\bhx-[\w:-]+\s*=/.test(source ?? '') ||
    /\bhtmx\b/i.test(source ?? '')
  const hasAlpineMarkers =
    HTML_ALPINE_ARTIFACT_LANGUAGE_ALIASES.has(normalizedLanguage) ||
    HTML_HTMX_ALPINE_ARTIFACT_LANGUAGE_ALIASES.has(normalizedLanguage) ||
    /\bx-data\s*=/.test(source ?? '') ||
    /\bx-(?:init|show|if|for|model|bind|on|ref|transition|cloak)\b/.test(source ?? '') ||
    /\bAlpine\b/.test(source ?? '')

  if (HtmlArtifactRuntimeProfileIdSchema.options.includes(normalizedLanguage as HtmlArtifactRuntimeProfileId)) {
    if (normalizedLanguage !== 'html') {
      return normalizedLanguage as HtmlArtifactRuntimeProfileId
    }

    if (hasHtmxMarkers && hasAlpineMarkers) {
      return 'html+htmx+alpine'
    }
    if (hasHtmxMarkers) {
      return 'html+htmx'
    }
    if (hasAlpineMarkers) {
      return 'html+alpine'
    }

    return defaults?.defaultHtmlRuntimeProfileId ?? 'html'
  }

  if (hasHtmxMarkers && hasAlpineMarkers) {
    return 'html+htmx+alpine'
  }
  if (hasHtmxMarkers) {
    return 'html+htmx'
  }
  if (hasAlpineMarkers) {
    return 'html+alpine'
  }

  return null
}

export function parseArtifactLanguage(
  language: string | null | undefined,
  defaults?: Pick<ArtifactSettings, 'defaultHtmlRuntimeProfileId' | 'defaultReactRuntimeProfileId'>,
  source?: string
): ArtifactLanguageDescriptor | null {
  const normalized = language?.toLowerCase() ?? ''

  if (REACT_ARTIFACT_LANGUAGE_ALIASES.has(normalized) || LEGACY_REACT_ARTIFACT_LANGUAGE_ALIASES.has(normalized)) {
    const profileId = defaults?.defaultReactRuntimeProfileId ?? 'react-default'

    return {
      kind: 'react',
      runtimeProfileId: profileId,
      displayType: 'React/TSX Artifact',
      editorLanguage: 'tsx',
      sourceLanguage: normalized === 'jsx-artifact' ? 'jsx' : 'tsx'
    }
  }

  if (looksLikeReactArtifactSource(source)) {
    const profileId = defaults?.defaultReactRuntimeProfileId ?? 'react-default'

    return {
      kind: 'react',
      runtimeProfileId: profileId,
      displayType: 'React/TSX Artifact',
      editorLanguage: 'tsx',
      sourceLanguage: 'tsx'
    }
  }

  const htmlRuntimeProfileId = detectHtmlRuntimeProfileId(normalized, source, defaults)

  if (htmlRuntimeProfileId) {
    const profile = HTML_ARTIFACT_RUNTIME_PROFILES.find((item) => item.id === htmlRuntimeProfileId)

    return {
      kind: 'html',
      runtimeProfileId: htmlRuntimeProfileId,
      displayType: profile?.label ?? 'HTML',
      editorLanguage: 'html',
      sourceLanguage: 'html'
    }
  }

  return null
}

export function getDefaultArtifactSettings(): ArtifactSettings {
  return ArtifactSettingsSchema.parse({})
}
