import * as z from 'zod'

export const WindowKindSchema = z.enum([
  'mainWindow',
  'MiniWindow',
  'SelectionToolbar',
  'SelectionActionWindow',
  'TraceWindow',
  'ArtifactPreview',
  'Worker',
  'unknown'
])
export type WindowKind = z.infer<typeof WindowKindSchema>

export const RendererCapabilitiesSchema = z.object({
  hasPreloadBridge: z.boolean(),
  hasFileApi: z.boolean(),
  hasShellApi: z.boolean(),
  canLogToMain: z.boolean(),
  isTrustedPreview: z.boolean()
})
export type RendererCapabilities = z.infer<typeof RendererCapabilitiesSchema>

export const RendererRuntimeEnvironmentSchema = z.object({
  windowKind: WindowKindSchema,
  capabilities: RendererCapabilitiesSchema
})
export type RendererRuntimeEnvironment = z.infer<typeof RendererRuntimeEnvironmentSchema>

export function resolveWindowKindFromPath(pathname: string): WindowKind {
  const normalizedPath = pathname.toLowerCase()

  if (normalizedPath.endsWith('/miniwindow.html')) {
    return 'MiniWindow'
  }

  if (normalizedPath.endsWith('/selectiontoolbar.html')) {
    return 'SelectionToolbar'
  }

  if (normalizedPath.endsWith('/selectionaction.html')) {
    return 'SelectionActionWindow'
  }

  if (normalizedPath.endsWith('/tracewindow.html')) {
    return 'TraceWindow'
  }

  if (normalizedPath.endsWith('/artifactpreview.html')) {
    return 'ArtifactPreview'
  }

  if (normalizedPath.endsWith('/index.html')) {
    return 'mainWindow'
  }

  return 'unknown'
}
