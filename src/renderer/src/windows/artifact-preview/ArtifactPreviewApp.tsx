import { loggerService } from '@logger'
import { getArtifactPreviewSession } from '@renderer/artifacts/previewSessions'
import { getRendererCapabilities } from '@renderer/runtime/environment'
import type { ArtifactPreviewSession } from '@shared/artifacts'
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('ArtifactPreview')

function getSessionId(): string {
  return new URLSearchParams(window.location.search).get('session') ?? ''
}

function isServiceBridgePayload(source?: string): boolean {
  return (
    source === 'artifact-service-request' ||
    source === 'artifact-service-response' ||
    source === 'artifact-service-subscription-ack' ||
    source === 'artifact-service-subscription-event'
  )
}

export default function ArtifactPreviewApp() {
  const sessionId = useMemo(() => getSessionId(), [])
  const innerFrameRef = useRef<HTMLIFrameElement>(null)
  const missingSessionAttemptsRef = useRef(0)
  const [session, setSession] = useState<ArtifactPreviewSession | null>(() =>
    sessionId ? getArtifactPreviewSession(sessionId) : null
  )

  const requestSessionSync = useCallback(() => {
    if (!sessionId) {
      return
    }

    window.parent.postMessage(
      {
        source: 'artifact-preview-session-request',
        sessionId
      },
      '*'
    )
  }, [sessionId])

  const refreshSession = useCallback(() => {
    if (!sessionId) {
      setSession(null)
      return
    }

    const nextSession = getArtifactPreviewSession(sessionId)
    setSession(nextSession)

    if (!nextSession) {
      missingSessionAttemptsRef.current += 1
      requestSessionSync()

      if (missingSessionAttemptsRef.current >= 3) {
        logger.warn(`Artifact preview session "${sessionId}" was not found.`, {
          capabilities: getRendererCapabilities()
        })
      }
      return
    }

    missingSessionAttemptsRef.current = 0
  }, [requestSessionSync, sessionId])

  useEffect(() => {
    refreshSession()
  }, [refreshSession])

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const retryTimers = [50, 150].map((delay) =>
      window.setTimeout(() => {
        if (!getArtifactPreviewSession(sessionId)) {
          refreshSession()
        }
      }, delay)
    )

    return () => {
      retryTimers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [refreshSession, sessionId])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; sessionId?: string } | undefined
      if (!data || typeof data !== 'object') {
        return
      }

      if (event.source === innerFrameRef.current?.contentWindow && isServiceBridgePayload(data.source)) {
        window.parent.postMessage(data, '*')
        return
      }

      if (event.source !== window.parent) {
        return
      }

      if (data.source === 'artifact-preview-session-update' && data.sessionId === sessionId) {
        refreshSession()
        return
      }

      if (isServiceBridgePayload(data.source)) {
        innerFrameRef.current?.contentWindow?.postMessage(data, '*')
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [refreshSession, sessionId])

  useEffect(() => {
    document.title = session?.title ?? 'Artifact Preview'
  }, [session?.title])

  if (!session) {
    return (
      <div style={emptyStateStyles}>
        <strong>Artifact preview unavailable.</strong>
        <span>Reload the preview to recreate the trusted preview session.</span>
      </div>
    )
  }

  return (
    // eslint-disable-next-line @eslint-react/dom/no-missing-iframe-sandbox
    <iframe
      ref={innerFrameRef}
      data-artifact-preview-content="true"
      srcDoc={session.document}
      title={session.title}
      allow="clipboard-read; clipboard-write"
      style={frameStyles}
    />
  )
}

const emptyStateStyles: CSSProperties = {
  alignItems: 'center',
  color: '#64748b',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'Inter, system-ui, sans-serif',
  gap: '8px',
  height: '100%',
  justifyContent: 'center',
  padding: '24px',
  textAlign: 'center'
}

const frameStyles: CSSProperties = {
  border: 'none',
  display: 'block',
  height: '100%',
  width: '100%'
}
