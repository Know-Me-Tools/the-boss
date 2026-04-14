import type {
  GraphQLServiceDefinition,
  ImportGraphQLServiceRequest,
  ImportOpenAPIServiceRequest,
  ImportSupabaseServiceRequest,
  OpenAPIServiceDefinition,
  ServiceDefinition,
  ServiceMetadataPatch
} from '@shared/services'
import { useCallback, useEffect, useState } from 'react'

export function useServices() {
  const [services, setServices] = useState<ServiceDefinition[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const next = await window.api.services.list()
      setServices(next)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const importOpenAPI = useCallback(
    async (request: ImportOpenAPIServiceRequest): Promise<OpenAPIServiceDefinition> => {
      const service = (await window.api.services.importOpenAPI(request)) as OpenAPIServiceDefinition
      await reload()
      return service
    },
    [reload]
  )

  const importGraphQL = useCallback(
    async (request: ImportGraphQLServiceRequest): Promise<GraphQLServiceDefinition> => {
      const service = (await window.api.services.importGraphQL(request)) as GraphQLServiceDefinition
      await reload()
      return service
    },
    [reload]
  )

  const importSupabase = useCallback(
    async (request: ImportSupabaseServiceRequest): Promise<ServiceDefinition> => {
      const service = await window.api.services.importSupabase(request)
      await reload()
      return service
    },
    [reload]
  )

  const updateService = useCallback(
    async (id: string, patch: ServiceMetadataPatch): Promise<ServiceDefinition> => {
      const service = await window.api.services.updateMetadata(id, patch)
      await reload()
      return service
    },
    [reload]
  )

  const deleteService = useCallback(
    async (id: string): Promise<boolean> => {
      const deleted = await window.api.services.delete(id)
      if (deleted) {
        await reload()
      }
      return deleted
    },
    [reload]
  )

  return {
    services,
    loading,
    reload,
    importOpenAPI,
    importGraphQL,
    importSupabase,
    updateService,
    deleteService
  }
}
