import type { ArtifactPreviewSession, ArtifactPreviewSessionSeed } from '@shared/artifacts'

const STORE_KEY = '__artifactPreviewSessions__'

type PreviewSessionHost = Window &
  typeof globalThis & {
    [STORE_KEY]?: Map<string, ArtifactPreviewSession>
  }

function getSessionHost(sourceWindow: Window = window): PreviewSessionHost {
  const parentWindow =
    sourceWindow.parent && sourceWindow.parent !== sourceWindow
      ? (sourceWindow.parent as PreviewSessionHost)
      : undefined

  return parentWindow ?? (sourceWindow as PreviewSessionHost)
}

function getStore(sourceWindow: Window = window): Map<string, ArtifactPreviewSession> {
  const host = getSessionHost(sourceWindow)
  host[STORE_KEY] ??= new Map<string, ArtifactPreviewSession>()
  return host[STORE_KEY]
}

export function createArtifactPreviewSessionId(): string {
  return `artifact-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createArtifactPreviewSession(seed: ArtifactPreviewSessionSeed): ArtifactPreviewSession {
  return {
    ...seed,
    id: createArtifactPreviewSessionId(),
    updatedAt: new Date().toISOString()
  }
}

export function upsertArtifactPreviewSession(
  session: ArtifactPreviewSession | ArtifactPreviewSessionSeed,
  sourceWindow: Window = window
): ArtifactPreviewSession {
  const completeSession: ArtifactPreviewSession = 'id' in session ? session : createArtifactPreviewSession(session)

  getStore(sourceWindow).set(completeSession.id, completeSession)
  return completeSession
}

export function getArtifactPreviewSession(
  sessionId: string,
  sourceWindow: Window = window
): ArtifactPreviewSession | null {
  return getStore(sourceWindow).get(sessionId) ?? null
}

export function removeArtifactPreviewSession(sessionId: string, sourceWindow: Window = window): void {
  getStore(sourceWindow).delete(sessionId)
}
