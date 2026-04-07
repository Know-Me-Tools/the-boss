import { loadArtifactSettings, saveArtifactSettings } from '@renderer/artifacts/config'
import type { ArtifactSettings } from '@shared/artifacts'
import { ArtifactSettingsSchema, getDefaultArtifactSettings } from '@shared/artifacts'
import { useCallback, useEffect, useState } from 'react'

export function useArtifactSettings() {
  const [settings, setSettings] = useState<ArtifactSettings>(getDefaultArtifactSettings())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    void loadArtifactSettings()
      .then((value) => {
        if (!cancelled) {
          setSettings(value)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const updateSettings = useCallback(
    async (updater: ArtifactSettings | ((prev: ArtifactSettings) => ArtifactSettings)) => {
      setSettings((prev) => {
        const rawNext = typeof updater === 'function' ? updater(prev) : updater
        const next = ArtifactSettingsSchema.parse(rawNext)
        void saveArtifactSettings(next)
        return next
      })
    },
    []
  )

  const reload = useCallback(async () => {
    setLoading(true)
    const next = await loadArtifactSettings()
    setSettings(next)
    setLoading(false)
  }, [])

  return {
    settings,
    loading,
    updateSettings,
    reload
  }
}
