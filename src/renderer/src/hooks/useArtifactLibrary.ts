import type { ArtifactKind, ArtifactMetadataPatch, ArtifactRecord, ArtifactRecordDraft } from '@shared/artifacts'
import { useCallback, useEffect, useMemo, useState } from 'react'

export function useArtifactLibrary() {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<ArtifactKind | 'all'>('all')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const next = await window.api.artifacts.list()
      setArtifacts(next)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const saveArtifact = useCallback(
    async (draft: ArtifactRecordDraft) => {
      const record = await window.api.artifacts.save(draft)
      await reload()
      return record
    },
    [reload]
  )

  const updateMetadata = useCallback(
    async (id: string, patch: ArtifactMetadataPatch) => {
      const record = await window.api.artifacts.updateMetadata(id, patch)
      await reload()
      return record
    },
    [reload]
  )

  const forkArtifact = useCallback(
    async (id: string) => {
      const record = await window.api.artifacts.fork(id)
      await reload()
      return record
    },
    [reload]
  )

  const deleteArtifact = useCallback(
    async (id: string) => {
      const result = await window.api.artifacts.delete(id)
      await reload()
      return result
    },
    [reload]
  )

  const filteredArtifacts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return artifacts.filter((artifact) => {
      if (kind !== 'all' && artifact.kind !== kind) {
        return false
      }

      if (!normalizedSearch) {
        return true
      }

      return (
        artifact.title.toLowerCase().includes(normalizedSearch) ||
        artifact.latestSource.toLowerCase().includes(normalizedSearch) ||
        artifact.runtimeProfileId.toLowerCase().includes(normalizedSearch)
      )
    })
  }, [artifacts, kind, search])

  return {
    artifacts: filteredArtifacts,
    allArtifacts: artifacts,
    loading,
    search,
    setSearch,
    kind,
    setKind,
    reload,
    saveArtifact,
    updateMetadata,
    forkArtifact,
    deleteArtifact
  }
}
