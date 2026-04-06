import type { RendererCapabilities, RendererRuntimeEnvironment, WindowKind } from '@shared/runtime'

const FALLBACK_WINDOW_KIND: WindowKind = 'unknown'

function resolveFallbackWindowKind(): WindowKind {
  if (typeof window === 'undefined') {
    return 'Worker'
  }

  const pathname = window.location.pathname.toLowerCase()

  if (pathname.endsWith('/miniwindow.html')) {
    return 'MiniWindow'
  }

  if (pathname.endsWith('/selectiontoolbar.html')) {
    return 'SelectionToolbar'
  }

  if (pathname.endsWith('/selectionaction.html')) {
    return 'SelectionActionWindow'
  }

  if (pathname.endsWith('/tracewindow.html')) {
    return 'TraceWindow'
  }

  if (pathname.endsWith('/artifactpreview.html')) {
    return 'ArtifactPreview'
  }

  if (pathname.endsWith('/index.html')) {
    return 'mainWindow'
  }

  return FALLBACK_WINDOW_KIND
}

function getWindowApi() {
  if (typeof window === 'undefined') {
    return undefined
  }

  return (window as Window & { api?: typeof window.api }).api
}

export function getRendererRuntimeEnvironment(): RendererRuntimeEnvironment {
  const api = getWindowApi()

  return (
    api?.runtime?.getEnvironment?.() ?? {
      windowKind: resolveFallbackWindowKind(),
      capabilities: {
        hasPreloadBridge: Boolean(api),
        hasFileApi: Boolean(api?.file),
        hasShellApi: Boolean(api?.shell),
        canLogToMain: Boolean(api?.logToMain),
        isTrustedPreview: resolveFallbackWindowKind() === 'ArtifactPreview'
      }
    }
  )
}

export function getRendererWindowKind(): WindowKind {
  return getRendererRuntimeEnvironment().windowKind
}

export function getRendererCapabilities(): RendererCapabilities {
  return getRendererRuntimeEnvironment().capabilities
}

export function getSafeWindowApi() {
  return getWindowApi()
}
