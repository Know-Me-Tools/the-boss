import { loggerService } from '@logger'
import { SYSTEM_MODELS } from '@renderer/config/models/default'
import { type Model, SystemProviderIds } from '@renderer/types'
import { CONTROL_PLANE_CATALOG_URL, CONTROL_PLANE_HEALTH_URL, THE_BOSS_OPENAI_API_URL } from '@shared/config/branding'
import { defaultAppHeaders } from '@shared/utils'

const logger = loggerService.withContext('ControlPlaneService')

const REQUEST_TIMEOUT_MS = 2500
const CACHE_TTL_MS = 60_000

export interface ControlPlaneHealthResponse {
  status?: string
  service?: string
  version?: string
}

export interface ControlPlaneHealthResult extends ControlPlaneHealthResponse {
  available: boolean
}

export interface ControlPlaneProviderDescriptor {
  id: string
  name: string
  type?: string
  apiHost?: string
  api_host?: string
  enabled?: boolean
}

export interface ControlPlaneModelDescriptor {
  id: string
  name?: string
  provider?: string
  group?: string
  owned_by?: string
  description?: string
  endpoint_type?: Model['endpoint_type']
  supported_endpoint_types?: Model['supported_endpoint_types']
}

export interface ControlPlaneDefaultsDescriptor {
  provider?: string
  model?: string
  defaultModel?: string
  default_model?: string
  apiHost?: string
  api_host?: string
}

type CacheEntry<T> = {
  expiresAt: number
  value: T
}

let healthCache: CacheEntry<ControlPlaneHealthResult> | null = null
let providerCache: CacheEntry<ControlPlaneProviderDescriptor[]> | null = null
let modelCache: CacheEntry<Model[]> | null = null
let defaultsCache: CacheEntry<ControlPlaneDefaultsDescriptor> | null = null

function getCached<T>(entry: CacheEntry<T> | null): T | null {
  if (!entry || entry.expiresAt <= Date.now()) {
    return null
  }
  return entry.value
}

function setCached<T>(value: T): CacheEntry<T> {
  return { value, expiresAt: Date.now() + CACHE_TTL_MS }
}

function fallbackTheBossModels(): Model[] {
  return SYSTEM_MODELS.theboss.map((model) => ({ ...model }))
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Control-plane response must be a JSON object')
  }
  return value as Record<string, unknown>
}

function extractArrayPayload(payload: unknown, key: string): unknown[] {
  if (Array.isArray(payload)) {
    return payload
  }

  const record = asRecord(payload)
  if (Array.isArray(record[key])) {
    return record[key]
  }
  if (Array.isArray(record.data)) {
    return record.data
  }

  throw new Error(`Control-plane response is missing ${key}`)
}

function extractObjectPayload(payload: unknown, key: string): Record<string, unknown> {
  const record = asRecord(payload)
  if (record[key] && typeof record[key] === 'object' && !Array.isArray(record[key])) {
    return record[key] as Record<string, unknown>
  }
  return record
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Control-plane descriptor is missing ${field}`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function mapProviderDescriptor(value: unknown): ControlPlaneProviderDescriptor {
  const record = asRecord(value)
  const id = requiredString(record.id, 'id')
  return {
    id,
    name: optionalString(record.name) ?? id,
    type: optionalString(record.type),
    apiHost: optionalString(record.apiHost),
    api_host: optionalString(record.api_host),
    enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined
  }
}

function mapModelDescriptor(value: unknown): Model {
  const record = asRecord(value)
  const id = requiredString(record.id, 'id')
  const provider = optionalString(record.provider) ?? SystemProviderIds.theboss
  return {
    id,
    name: optionalString(record.name) ?? id,
    provider,
    group: optionalString(record.group) ?? (provider === SystemProviderIds.theboss ? 'The Boss' : provider),
    owned_by: optionalString(record.owned_by),
    description: optionalString(record.description),
    endpoint_type: record.endpoint_type as Model['endpoint_type'],
    supported_endpoint_types: Array.isArray(record.supported_endpoint_types)
      ? (record.supported_endpoint_types as Model['supported_endpoint_types'])
      : undefined
  }
}

function mapDefaultsDescriptor(value: unknown): ControlPlaneDefaultsDescriptor {
  const record = extractObjectPayload(value, 'defaults')
  return {
    provider: optionalString(record.provider) ?? SystemProviderIds.theboss,
    model: optionalString(record.model),
    defaultModel: optionalString(record.defaultModel),
    default_model: optionalString(record.default_model),
    apiHost: optionalString(record.apiHost) ?? THE_BOSS_OPENAI_API_URL,
    api_host: optionalString(record.api_host)
  }
}

async function fetchJson<T>(url: string, signal: AbortSignal | undefined, map: (payload: unknown) => T): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const abort = () => controller.abort()

  signal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...defaultAppHeaders()
      },
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(`Control-plane request failed with HTTP ${response.status}`)
    }

    return map(await response.json())
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

export async function getControlPlaneHealth(signal?: AbortSignal): Promise<ControlPlaneHealthResult> {
  const cached = getCached(healthCache)
  if (cached) {
    return cached
  }

  try {
    const value = await fetchJson(CONTROL_PLANE_HEALTH_URL, signal, (payload) => {
      const record = asRecord(payload)
      return {
        available: true,
        status: optionalString(record.status),
        service: optionalString(record.service),
        version: optionalString(record.version)
      }
    })
    healthCache = setCached(value)
    return value
  } catch (error) {
    logger.warn('Control-plane health unavailable', error as Error)
    return { available: false, status: 'unavailable' }
  }
}

export async function getControlPlaneCatalogProviders(signal?: AbortSignal): Promise<ControlPlaneProviderDescriptor[]> {
  const cached = getCached(providerCache)
  if (cached) {
    return cached
  }

  try {
    const value = await fetchJson(`${CONTROL_PLANE_CATALOG_URL}/providers`, signal, (payload) =>
      extractArrayPayload(payload, 'providers').map(mapProviderDescriptor)
    )
    providerCache = setCached(value)
    return value
  } catch (error) {
    logger.warn('Control-plane provider catalog unavailable; using static The Boss provider fallback', error as Error)
    return [
      {
        id: SystemProviderIds.theboss,
        name: 'The Boss',
        type: 'openai',
        apiHost: THE_BOSS_OPENAI_API_URL,
        enabled: true
      }
    ]
  }
}

export async function getControlPlaneCatalogModels(signal?: AbortSignal): Promise<Model[]> {
  const cached = getCached(modelCache)
  if (cached) {
    return cached
  }

  try {
    const value = await fetchJson(`${CONTROL_PLANE_CATALOG_URL}/models`, signal, (payload) =>
      extractArrayPayload(payload, 'models').map(mapModelDescriptor)
    )
    if (value.length === 0) {
      throw new Error('Control-plane model catalog is empty')
    }
    modelCache = setCached(value)
    return value
  } catch (error) {
    logger.warn('Control-plane model catalog unavailable; using static The Boss fallback catalog', error as Error)
    return fallbackTheBossModels()
  }
}

export async function getControlPlaneCatalogDefaults(signal?: AbortSignal): Promise<ControlPlaneDefaultsDescriptor> {
  const cached = getCached(defaultsCache)
  if (cached) {
    return cached
  }

  try {
    const value = await fetchJson(`${CONTROL_PLANE_CATALOG_URL}/defaults`, signal, mapDefaultsDescriptor)
    defaultsCache = setCached(value)
    return value
  } catch (error) {
    logger.warn('Control-plane defaults unavailable; using static The Boss defaults', error as Error)
    return {
      provider: SystemProviderIds.theboss,
      model: SYSTEM_MODELS.theboss[0]?.id,
      defaultModel: SYSTEM_MODELS.theboss[0]?.id,
      apiHost: THE_BOSS_OPENAI_API_URL
    }
  }
}

export function __resetControlPlaneServiceCacheForTests(): void {
  healthCache = null
  providerCache = null
  modelCache = null
  defaultsCache = null
}
