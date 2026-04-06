import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import {
  buildOpenAPIOperationId,
  buildServiceToolId,
  type GraphQLServiceDefinition,
  type GraphQLServiceOperation,
  GraphQLServiceOperationSchema,
  type ImportGraphQLServiceRequest,
  ImportGraphQLServiceRequestSchema,
  type ImportOpenAPIServiceRequest,
  ImportOpenAPIServiceRequestSchema,
  InvokeServiceOperationRequestSchema,
  type InvokeServiceResponse,
  InvokeServiceResponseSchema,
  InvokeServiceToolRequestSchema,
  type JsonSchemaLike,
  type OpenAPIServiceDefinition,
  ServiceConnectionTestResultSchema,
  type ServiceDefinition,
  ServiceDefinitionSchema,
  type ServiceHeaderTemplate,
  type ServiceImportSource,
  ServiceListQuerySchema,
  type ServiceRegistryFile,
  ServiceRegistryFileSchema,
  type ServiceSubscriptionEvent,
  ServiceSubscriptionEventSchema,
  type ServiceToolProjection,
  type ServiceToolSummary,
  ServiceToolSummarySchema,
  SubscribeServiceOperationRequestSchema,
  UpdateServiceMetadataRequestSchema
} from '@shared/services'
import { safeStorage, webContents } from 'electron'
import {
  buildASTSchema,
  buildClientSchema,
  getIntrospectionQuery,
  type IntrospectionQuery,
  parse,
  printSchema
} from 'graphql'
import WebSocket from 'ws'
import { parse as parseYaml } from 'yaml'

import { getDataPath } from '../utils'
import { writeWithLock } from '../utils/file'

const logger = loggerService.withContext('ServiceRegistryService')

type PersistedSecretsFile = {
  version: 1
  secrets: Record<string, string>
}

type SubscriptionEntry = {
  id: string
  socket: WebSocket
  webContentsId: number
}

type ResolvedHeader = {
  name: string
  value: string
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const
const GRAPHQL_WS_PROTOCOL = 'graphql-transport-ws'

function nowIso(): string {
  return new Date().toISOString()
}

function createImportHash(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

function serviceRegistryPath() {
  return path.join(getDataPath('Data'), 'services.json')
}

function serviceSecretsPath() {
  return path.join(getDataPath('Data'), 'service-secrets.json')
}

function maybeEncrypt(value: string): string {
  if (typeof safeStorage?.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(value).toString('base64')}`
  }

  return `plain:${Buffer.from(value, 'utf-8').toString('base64')}`
}

function maybeDecrypt(value: string): string {
  if (value.startsWith('enc:')) {
    const buffer = Buffer.from(value.slice(4), 'base64')
    return safeStorage.decryptString(buffer)
  }

  if (value.startsWith('plain:')) {
    return Buffer.from(value.slice(6), 'base64').toString('utf-8')
  }

  return value
}

function sanitizeIdentifier(value: string): string {
  const trimmed = value.trim()
  const parts = trimmed.match(/[a-zA-Z0-9]+/g) ?? ['service']
  return parts
    .map((part, index) => (index === 0 ? part.toLowerCase() : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join('')
}

function toTitleCaseIdentifier(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
}

function toJsonSchemaFromOpenApiSchema(schema: any): JsonSchemaLike {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} }
  }

  const cloned = JSON.parse(JSON.stringify(schema))
  if (!cloned.type && !cloned.properties && !cloned.items) {
    return { type: 'object', properties: {} }
  }

  return cloned as JsonSchemaLike
}

function dedupeProjectionNames(projections: ServiceToolProjection[]): ServiceToolProjection[] {
  const seen = new Set<string>()

  return projections.map((projection) => {
    if (!seen.has(projection.id)) {
      seen.add(projection.id)
      return projection
    }

    let counter = 2
    let nextId = `${projection.id}_${counter}`
    while (seen.has(nextId)) {
      counter += 1
      nextId = `${projection.id}_${counter}`
    }
    seen.add(nextId)
    return { ...projection, id: nextId }
  })
}

async function readSourceText(sourceType: 'url' | 'file' | 'text', source: string): Promise<string> {
  if (sourceType === 'url') {
    const response = await fetch(source)
    if (!response.ok) {
      throw new Error(`Failed to fetch service definition: HTTP ${response.status}`)
    }
    return response.text()
  }

  if (sourceType === 'file') {
    return fs.readFile(source, 'utf-8')
  }

  return source
}

function parseStructuredDocument(source: string): any {
  try {
    return JSON.parse(source)
  } catch {
    return parseYaml(source)
  }
}

function buildOpenApiInputSchema(operation: any, pathItem: any): JsonSchemaLike {
  const parameters = [...(pathItem?.parameters ?? []), ...(operation?.parameters ?? [])]
  const pathProperties: Record<string, unknown> = {}
  const queryProperties: Record<string, unknown> = {}
  const headerProperties: Record<string, unknown> = {}
  const pathRequired: string[] = []
  const queryRequired: string[] = []
  const headerRequired: string[] = []

  for (const parameter of parameters) {
    const target =
      parameter.in === 'path' ? pathProperties : parameter.in === 'header' ? headerProperties : queryProperties
    const required = parameter.in === 'path' ? pathRequired : parameter.in === 'header' ? headerRequired : queryRequired

    target[parameter.name] = toJsonSchemaFromOpenApiSchema(parameter.schema ?? { type: 'string' })
    if (parameter.required) {
      required.push(parameter.name)
    }
  }

  const requestBodySchema = operation?.requestBody?.content
    ? Object.values(operation.requestBody.content)[0]
    : undefined

  return {
    type: 'object',
    properties: {
      path: {
        type: 'object',
        properties: pathProperties,
        required: pathRequired
      },
      query: {
        type: 'object',
        properties: queryProperties,
        required: queryRequired
      },
      headers: {
        type: 'object',
        properties: headerProperties,
        required: headerRequired
      },
      body: requestBodySchema ? toJsonSchemaFromOpenApiSchema((requestBodySchema as any).schema) : { type: 'object' }
    },
    required: []
  }
}

function syncGraphQLProjectedTools(operations: GraphQLServiceOperation[]): ServiceToolProjection[] {
  const projected = operations
    .filter((operation) => operation.projected && operation.operationType !== 'subscription')
    .map<ServiceToolProjection>((operation) => ({
      id: sanitizeIdentifier(operation.projectionName ?? operation.name),
      kind: operation.operationType === 'query' ? 'graphql-query' : 'graphql-mutation',
      sourceOperationId: operation.id,
      name: operation.projectionName ?? operation.name,
      description: operation.description ?? '',
      enabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          variables: operation.variablesSchema
        }
      },
      additionalHeaders: []
    }))

  return dedupeProjectionNames(projected)
}

function buildOpenApiDefinition(params: {
  request: ImportOpenAPIServiceRequest
  sourceText: string
  auth: OpenAPIServiceDefinition['auth']
  headerTemplates: OpenAPIServiceDefinition['headerTemplates']
  previous?: OpenAPIServiceDefinition
}): OpenAPIServiceDefinition {
  const document = parseStructuredDocument(params.sourceText)
  const openapiVersion = String(document?.openapi ?? '')
  if (!openapiVersion.startsWith('3.')) {
    throw new Error(`Unsupported OpenAPI version "${openapiVersion}". Only OpenAPI 3.x is supported.`)
  }

  const serviceId = params.request.serviceId ?? params.previous?.serviceId ?? randomUUID()
  const timestamp = nowIso()
  const serverUrls = Array.isArray(document?.servers)
    ? document.servers
        .map((server: any) => server?.url)
        .filter((url: unknown): url is string => typeof url === 'string')
    : []
  const endpoint = params.request.endpoint ?? serverUrls[0]
  if (!endpoint) {
    throw new Error('OpenAPI import requires a server URL or endpoint override.')
  }

  const operations = Object.entries<any>(document?.paths ?? {}).flatMap(([pathName, pathItem]) =>
    HTTP_METHODS.flatMap((method) => {
      const operation = pathItem?.[method]
      if (!operation) {
        return []
      }

      const operationId = operation.operationId || buildOpenAPIOperationId(method, pathName)

      return [
        {
          id: operationId,
          method,
          path: pathName,
          operationId,
          summary: operation.summary,
          description: operation.description,
          inputSchema: buildOpenApiInputSchema(operation, pathItem),
          security: operation.security ?? document.security ?? []
        }
      ]
    })
  )

  const previousProjections = new Map(
    (params.previous?.projectedTools ?? []).map((projection) => [projection.sourceOperationId, projection])
  )
  const projectedTools = dedupeProjectionNames(
    operations.map<ServiceToolProjection>((operation) => {
      const previousProjection = previousProjections.get(operation.id)

      return {
        id: previousProjection?.id ?? sanitizeIdentifier(operation.operationId),
        kind: 'openapi-operation',
        sourceOperationId: operation.id,
        name: previousProjection?.name ?? toTitleCaseIdentifier(operation.operationId),
        description: previousProjection?.description ?? operation.summary ?? operation.description ?? '',
        enabled: previousProjection?.enabled ?? false,
        inputSchema: operation.inputSchema,
        additionalHeaders: previousProjection?.additionalHeaders ?? []
      }
    })
  )

  return ServiceDefinitionSchema.parse({
    serviceId,
    name: params.request.name,
    kind: 'openapi',
    endpoint,
    importSource: {
      type: params.request.sourceType,
      locator: params.request.source,
      importedAt: timestamp
    } satisfies ServiceImportSource,
    auth: params.auth,
    headerTemplates: params.headerTemplates,
    projectedTools,
    createdAt: params.previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
    refresh: {
      lastImportedAt: timestamp,
      lastRefreshedAt: timestamp,
      importHash: createImportHash(params.sourceText)
    },
    metadata: {
      title: document?.info?.title,
      version: document?.info?.version
    },
    serverUrls,
    specSnapshot: params.sourceText,
    operations
  }) as OpenAPIServiceDefinition
}

async function buildGraphQLDefinition(params: {
  request: ImportGraphQLServiceRequest
  auth: GraphQLServiceDefinition['auth']
  headerTemplates: GraphQLServiceDefinition['headerTemplates']
  previous?: GraphQLServiceDefinition
}): Promise<GraphQLServiceDefinition> {
  const timestamp = nowIso()
  let schemaSnapshot = params.request.source ?? ''

  if (params.request.sourceType === 'introspection') {
    const response = await fetch(params.request.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: getIntrospectionQuery()
      })
    })
    if (!response.ok) {
      throw new Error(`GraphQL introspection failed: HTTP ${response.status}`)
    }
    const data = await response.json()
    const schema = buildClientSchema(data.data as IntrospectionQuery)
    schemaSnapshot = printSchema(schema)
  } else if (!schemaSnapshot) {
    throw new Error('GraphQL SDL import requires SDL source.')
  } else {
    schemaSnapshot = printSchema(buildASTSchema(parse(schemaSnapshot)))
  }

  const existingOperations = params.previous?.operations ?? []

  return ServiceDefinitionSchema.parse({
    serviceId: params.request.serviceId ?? params.previous?.serviceId ?? randomUUID(),
    name: params.request.name,
    kind: 'graphql',
    endpoint: params.request.endpoint,
    subscriptionEndpoint: params.request.subscriptionEndpoint,
    subscriptionTransport: params.request.subscriptionTransport,
    importSource: {
      type: params.request.sourceType,
      locator: params.request.sourceType === 'introspection' ? params.request.endpoint : params.request.source,
      importedAt: timestamp
    } satisfies ServiceImportSource,
    auth: params.auth,
    headerTemplates: params.headerTemplates,
    projectedTools: syncGraphQLProjectedTools(existingOperations),
    createdAt: params.previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
    refresh: {
      lastImportedAt: timestamp,
      lastRefreshedAt: timestamp,
      importHash: createImportHash(schemaSnapshot)
    },
    metadata: {},
    schemaSnapshot,
    operations: existingOperations
  }) as GraphQLServiceDefinition
}

function resolveTemplateValue(template: ServiceHeaderTemplate, secrets: Record<string, string>): string {
  if (template.value.kind === 'literal') {
    return template.value.literal ?? ''
  }

  const secretId = template.value.secret?.id
  if (!secretId || !(secretId in secrets)) {
    throw new Error(`Missing secret for header "${template.name}".`)
  }

  return secrets[secretId]
}

function buildAuthHeaders(service: ServiceDefinition, secrets: Record<string, string>): ResolvedHeader[] {
  switch (service.auth.type) {
    case 'none':
      return []
    case 'bearer': {
      const token = secrets[service.auth.token.id]
      if (!token) {
        throw new Error(`Missing bearer token for service "${service.name}".`)
      }
      return [
        {
          name: service.auth.headerName,
          value: `${service.auth.scheme} ${token}`.trim()
        }
      ]
    }
    case 'api-key': {
      const token = secrets[service.auth.token.id]
      if (!token) {
        throw new Error(`Missing API key for service "${service.name}".`)
      }
      return [
        {
          name: service.auth.headerName,
          value: `${service.auth.prefix ?? ''}${token}`
        }
      ]
    }
    case 'basic': {
      const username = secrets[service.auth.username.id]
      const password = secrets[service.auth.password.id]
      if (!username || !password) {
        throw new Error(`Missing basic auth credentials for service "${service.name}".`)
      }
      return [
        {
          name: service.auth.headerName,
          value: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
        }
      ]
    }
  }
}

function buildServiceHeaders(
  service: ServiceDefinition,
  secrets: Record<string, string>,
  applyTo: 'request' | 'subscription-handshake' | 'subscription-init',
  additionalTemplates: ServiceHeaderTemplate[] = []
): Record<string, string> {
  const headers = new Map<string, string>()

  if (applyTo === 'request' || applyTo === 'subscription-handshake') {
    for (const header of buildAuthHeaders(service, secrets)) {
      headers.set(header.name, header.value)
    }
  }

  for (const template of [...service.headerTemplates, ...additionalTemplates]) {
    if (!template.enabled || !template.applyTo.includes(applyTo)) {
      continue
    }
    headers.set(template.name, resolveTemplateValue(template, secrets))
  }

  return Object.fromEntries(headers.entries())
}

function resolveProjectedTool(service: ServiceDefinition, toolId: string) {
  const projection = service.projectedTools.find((item) => buildServiceToolId(service.serviceId, item.id) === toolId)
  if (!projection || !projection.enabled) {
    return null
  }

  return projection
}

function resolveOperationFromProjection(service: ServiceDefinition, projection: ServiceToolProjection) {
  if (service.kind === 'openapi') {
    return service.operations.find((item) => item.id === projection.sourceOperationId) ?? null
  }

  return service.operations.find((item) => item.id === projection.sourceOperationId) ?? null
}

export class ServiceRegistryService {
  private readonly subscriptions = new Map<string, SubscriptionEntry>()

  private async readRegistry(): Promise<ServiceRegistryFile> {
    try {
      const content = await fs.readFile(serviceRegistryPath(), 'utf-8')
      return ServiceRegistryFileSchema.parse(JSON.parse(content))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return ServiceRegistryFileSchema.parse({})
      }

      logger.error('Failed to read services registry', error as Error)
      throw error
    }
  }

  private async writeRegistry(registry: ServiceRegistryFile): Promise<void> {
    const filePath = serviceRegistryPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const content = `${JSON.stringify(registry, null, 2)}\n`
    await writeWithLock(filePath, content, {
      atomic: true,
      encoding: 'utf-8'
    })
  }

  private async readSecrets(): Promise<Record<string, string>> {
    try {
      const content = await fs.readFile(serviceSecretsPath(), 'utf-8')
      const parsed = JSON.parse(content) as PersistedSecretsFile
      return Object.fromEntries(Object.entries(parsed.secrets ?? {}).map(([key, value]) => [key, maybeDecrypt(value)]))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {}
      }

      logger.error('Failed to read service secrets', error as Error)
      throw error
    }
  }

  private async writeSecrets(secrets: Record<string, string>): Promise<void> {
    const filePath = serviceSecretsPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const payload: PersistedSecretsFile = {
      version: 1,
      secrets: Object.fromEntries(Object.entries(secrets).map(([key, value]) => [key, maybeEncrypt(value)]))
    }
    await writeWithLock(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
      atomic: true,
      encoding: 'utf-8'
    })
  }

  private async upsertSecret(input?: {
    label?: string
    value: string
  }): Promise<{ id: string; label?: string } | undefined> {
    if (!input) {
      return undefined
    }

    const secretId = randomUUID()
    const secrets = await this.readSecrets()
    secrets[secretId] = input.value
    await this.writeSecrets(secrets)
    return {
      id: secretId,
      label: input.label
    }
  }

  private async materializeHeaderTemplates(templates: ImportOpenAPIServiceRequest['headerTemplates']) {
    return Promise.all(
      templates.map(async (template) => ({
        id: template.id ?? randomUUID(),
        name: template.name,
        enabled: template.enabled,
        applyTo: template.applyTo,
        value: template.secret
          ? {
              kind: 'secret' as const,
              secret: await this.upsertSecret(template.secret)
            }
          : {
              kind: 'literal' as const,
              literal: template.literal ?? ''
            }
      }))
    )
  }

  async listServices(query?: unknown): Promise<ServiceDefinition[]> {
    const parsedQuery = ServiceListQuerySchema.parse(query ?? {})
    const registry = await this.readRegistry()
    const search = parsedQuery.search?.trim().toLowerCase()

    return registry.services.filter((service) => {
      if (parsedQuery.kind && service.kind !== parsedQuery.kind) {
        return false
      }

      if (!search) {
        return true
      }

      return (
        service.name.toLowerCase().includes(search) ||
        service.endpoint.toLowerCase().includes(search) ||
        service.kind.toLowerCase().includes(search)
      )
    })
  }

  async getService(id: string): Promise<ServiceDefinition | null> {
    const registry = await this.readRegistry()
    return registry.services.find((service) => service.serviceId === id) ?? null
  }

  async importOpenAPIService(input: unknown): Promise<OpenAPIServiceDefinition> {
    const request = ImportOpenAPIServiceRequestSchema.parse(input)
    const [sourceText, registry] = await Promise.all([
      readSourceText(request.sourceType, request.source),
      this.readRegistry()
    ])
    const previous = registry.services.find(
      (service) => service.serviceId === request.serviceId && service.kind === 'openapi'
    ) as OpenAPIServiceDefinition | undefined

    const finalService = buildOpenApiDefinition({
      request,
      sourceText,
      previous,
      auth: await this.materializeAuth(request.auth),
      headerTemplates: await this.materializeHeaderTemplates(request.headerTemplates)
    })

    const nextRegistry = {
      ...registry,
      services: [...registry.services.filter((item) => item.serviceId !== finalService.serviceId), finalService].sort(
        (left, right) => right.updatedAt.localeCompare(left.updatedAt)
      )
    }
    await this.writeRegistry(nextRegistry)
    return finalService
  }

  private async materializeAuth(auth: ImportOpenAPIServiceRequest['auth']) {
    switch (auth.type) {
      case 'none':
        return { type: 'none' as const }
      case 'bearer':
        return {
          type: 'bearer' as const,
          headerName: auth.headerName,
          scheme: auth.scheme,
          token: (await this.upsertSecret(auth.token))!
        }
      case 'api-key':
        return {
          type: 'api-key' as const,
          headerName: auth.headerName,
          prefix: auth.prefix,
          token: (await this.upsertSecret(auth.token))!
        }
      case 'basic':
        return {
          type: 'basic' as const,
          headerName: auth.headerName,
          username: (await this.upsertSecret(auth.username))!,
          password: (await this.upsertSecret(auth.password))!
        }
    }
  }

  async importGraphQLService(input: unknown): Promise<GraphQLServiceDefinition> {
    const request = ImportGraphQLServiceRequestSchema.parse(input)
    const registry = await this.readRegistry()
    const previous = registry.services.find(
      (service) => service.serviceId === request.serviceId && service.kind === 'graphql'
    ) as GraphQLServiceDefinition | undefined

    const service = await buildGraphQLDefinition({
      request,
      previous,
      auth: await this.materializeAuth(request.auth),
      headerTemplates: await this.materializeHeaderTemplates(request.headerTemplates)
    })

    const nextRegistry: ServiceRegistryFile = {
      ...registry,
      services: [...registry.services.filter((item) => item.serviceId !== service.serviceId), service].sort(
        (left, right) => right.updatedAt.localeCompare(left.updatedAt)
      )
    }
    await this.writeRegistry(nextRegistry)
    return service
  }

  async updateServiceMetadata(input: unknown): Promise<ServiceDefinition> {
    const request = UpdateServiceMetadataRequestSchema.parse(input)
    const registry = await this.readRegistry()
    const current = registry.services.find((service) => service.serviceId === request.id)
    if (!current) {
      throw new Error(`Unknown service "${request.id}".`)
    }

    const patch = request.patch
    const timestamp = nowIso()
    const nextService: ServiceDefinition =
      current.kind === 'graphql'
        ? {
            ...current,
            name: patch.name ?? current.name,
            endpoint: patch.endpoint ?? current.endpoint,
            subscriptionEndpoint: patch.subscriptionEndpoint ?? current.subscriptionEndpoint,
            auth: patch.auth ? await this.materializeAuth(patch.auth) : current.auth,
            headerTemplates: patch.headerTemplates
              ? await this.materializeHeaderTemplates(patch.headerTemplates)
              : current.headerTemplates,
            operations: patch.graphqlOperations
              ? patch.graphqlOperations.map((operation) => GraphQLServiceOperationSchema.parse(operation))
              : current.operations,
            projectedTools:
              patch.projectedTools ?? syncGraphQLProjectedTools(patch.graphqlOperations ?? current.operations),
            updatedAt: timestamp
          }
        : {
            ...current,
            name: patch.name ?? current.name,
            endpoint: patch.endpoint ?? current.endpoint,
            auth: patch.auth ? await this.materializeAuth(patch.auth) : current.auth,
            headerTemplates: patch.headerTemplates
              ? await this.materializeHeaderTemplates(patch.headerTemplates)
              : current.headerTemplates,
            projectedTools: patch.projectedTools ?? current.projectedTools,
            updatedAt: timestamp
          }

    const nextRegistry: ServiceRegistryFile = {
      ...registry,
      services: registry.services.map((service) => (service.serviceId === request.id ? nextService : service))
    }
    await this.writeRegistry(nextRegistry)
    return nextService
  }

  async deleteService(id: string): Promise<boolean> {
    const registry = await this.readRegistry()
    const nextServices = registry.services.filter((service) => service.serviceId !== id)
    if (nextServices.length === registry.services.length) {
      return false
    }

    await this.writeRegistry({
      ...registry,
      services: nextServices
    })
    return true
  }

  async listProjectedTools(): Promise<ServiceToolSummary[]> {
    const registry = await this.readRegistry()

    return registry.services.flatMap((service) =>
      service.projectedTools
        .filter((projection) => projection.enabled)
        .map((projection) =>
          ServiceToolSummarySchema.parse({
            id: buildServiceToolId(service.serviceId, projection.id),
            name: projection.name,
            description: projection.description,
            serviceId: service.serviceId,
            serviceName: service.name,
            inputSchema: projection.inputSchema,
            projectionKind: projection.kind
          })
        )
    )
  }

  async invokeTool(input: unknown): Promise<InvokeServiceResponse> {
    const request = InvokeServiceToolRequestSchema.parse(input)
    const registry = await this.readRegistry()
    for (const service of registry.services) {
      const projection = resolveProjectedTool(service, request.toolId)
      if (!projection) {
        continue
      }
      return this.invokeProjection(service, projection, request.input)
    }

    throw new Error(`Unknown service tool "${request.toolId}".`)
  }

  async invokeOperation(input: unknown): Promise<InvokeServiceResponse> {
    const request = InvokeServiceOperationRequestSchema.parse(input)
    const service = await this.getService(request.serviceId)
    if (!service) {
      throw new Error(`Unknown service "${request.serviceId}".`)
    }

    if (service.kind === 'openapi') {
      const operation = service.operations.find((item) => item.id === request.operationId)
      if (!operation) {
        throw new Error(`Unknown OpenAPI operation "${request.operationId}".`)
      }
      return this.invokeOpenApiOperation(service, operation, request.input)
    }

    const operation = service.operations.find((item) => item.id === request.operationId)
    if (!operation) {
      throw new Error(`Unknown GraphQL operation "${request.operationId}".`)
    }

    if (operation.operationType === 'subscription') {
      throw new Error('Subscriptions must use the subscription lifecycle APIs.')
    }

    return this.invokeGraphQLOperation(service, operation, request.input)
  }

  private async invokeProjection(
    service: ServiceDefinition,
    projection: ServiceToolProjection,
    input: Record<string, unknown>
  ): Promise<InvokeServiceResponse> {
    const operation = resolveOperationFromProjection(service, projection)
    if (!operation) {
      throw new Error(`Unknown service operation "${projection.sourceOperationId}".`)
    }

    if (service.kind === 'openapi') {
      return this.invokeOpenApiOperation(
        service,
        operation as OpenAPIServiceDefinition['operations'][number],
        input,
        projection.additionalHeaders
      )
    }

    return this.invokeGraphQLOperation(
      service,
      operation as GraphQLServiceOperation,
      input,
      projection.additionalHeaders
    )
  }

  private async invokeOpenApiOperation(
    service: OpenAPIServiceDefinition,
    operation: OpenAPIServiceDefinition['operations'][number],
    input: Record<string, unknown>,
    additionalHeaders: ServiceHeaderTemplate[] = []
  ): Promise<InvokeServiceResponse> {
    const secrets = await this.readSecrets()
    const headers = {
      'Content-Type': 'application/json',
      ...buildServiceHeaders(service, secrets, 'request', additionalHeaders),
      ...((input.headers as Record<string, string> | undefined) ?? {})
    }

    const url = new URL(
      operation.path.replace(/{([^}]+)}/g, (_, key) => {
        const pathInput = (input.path as Record<string, unknown> | undefined) ?? input
        return encodeURIComponent(String(pathInput[key] ?? ''))
      }),
      service.endpoint
    )
    const queryInput = (input.query as Record<string, unknown> | undefined) ?? {}
    for (const [key, value] of Object.entries(queryInput)) {
      if (value === undefined || value === null) {
        continue
      }
      url.searchParams.set(key, String(value))
    }

    const response = await fetch(url, {
      method: operation.method.toUpperCase(),
      headers,
      body:
        operation.method === 'get' || operation.method === 'head'
          ? undefined
          : JSON.stringify(input.body ?? input.input ?? undefined)
    })
    const data = await readResponseData(response)
    return InvokeServiceResponseSchema.parse({
      ok: response.ok,
      status: response.status,
      data,
      headers: Object.fromEntries(response.headers.entries())
    })
  }

  private async invokeGraphQLOperation(
    service: GraphQLServiceDefinition,
    operation: GraphQLServiceOperation,
    input: Record<string, unknown>,
    additionalHeaders: ServiceHeaderTemplate[] = []
  ): Promise<InvokeServiceResponse> {
    const secrets = await this.readSecrets()
    const response = await fetch(service.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildServiceHeaders(service, secrets, 'request', additionalHeaders)
      },
      body: JSON.stringify({
        query: operation.text,
        variables: (input.variables as Record<string, unknown> | undefined) ?? input
      })
    })
    const data = await readResponseData(response)
    return InvokeServiceResponseSchema.parse({
      ok: response.ok && !(data && typeof data === 'object' && 'errors' in (data as Record<string, unknown>)),
      status: response.status,
      data,
      headers: Object.fromEntries(response.headers.entries())
    })
  }

  async subscribe(input: unknown, ownerWebContentsId: number): Promise<{ subscriptionId: string }> {
    const request = SubscribeServiceOperationRequestSchema.parse(input)
    const service = await this.getService(request.serviceId)
    if (!service || service.kind !== 'graphql') {
      throw new Error(`Unknown GraphQL service "${request.serviceId}".`)
    }

    const operation = service.operations.find((item) => item.id === request.operationId)
    if (!operation || operation.operationType !== 'subscription') {
      throw new Error(`Unknown GraphQL subscription "${request.operationId}".`)
    }

    const subscriptionId = randomUUID()
    const secrets = await this.readSecrets()
    const handshakeHeaders = buildServiceHeaders(service, secrets, 'subscription-handshake')
    const initPayload = buildServiceHeaders(service, secrets, 'subscription-init')
    const socket = new WebSocket(service.subscriptionEndpoint ?? service.endpoint, GRAPHQL_WS_PROTOCOL, {
      headers: handshakeHeaders
    })

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      socket,
      webContentsId: ownerWebContentsId
    })

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          type: 'connection_init',
          payload: initPayload
        })
      )
    })

    socket.on('message', (buffer) => {
      try {
        const message = JSON.parse(String(buffer))

        if (message.type === 'connection_ack') {
          this.emitSubscriptionEvent({
            subscriptionId,
            kind: 'ack'
          })
          socket.send(
            JSON.stringify({
              id: subscriptionId,
              type: 'subscribe',
              payload: {
                query: operation.text,
                variables: request.variables
              }
            })
          )
          return
        }

        if (message.type === 'next') {
          this.emitSubscriptionEvent({
            subscriptionId,
            kind: 'next',
            payload: message.payload
          })
          return
        }

        if (message.type === 'error') {
          this.emitSubscriptionEvent({
            subscriptionId,
            kind: 'error',
            payload: message.payload
          })
          return
        }

        if (message.type === 'complete') {
          this.emitSubscriptionEvent({
            subscriptionId,
            kind: 'complete'
          })
          this.cleanupSubscription(subscriptionId)
        }
      } catch (error) {
        logger.error('Failed to process GraphQL subscription event', error as Error)
      }
    })

    socket.on('error', (error) => {
      this.emitSubscriptionEvent({
        subscriptionId,
        kind: 'error',
        payload: error.message
      })
    })

    socket.on('close', () => {
      this.emitSubscriptionEvent({
        subscriptionId,
        kind: 'complete'
      })
      this.cleanupSubscription(subscriptionId)
    })

    return { subscriptionId }
  }

  unsubscribe(subscriptionId: string): boolean {
    const entry = this.subscriptions.get(subscriptionId)
    if (!entry) {
      return false
    }

    try {
      entry.socket.send(
        JSON.stringify({
          id: subscriptionId,
          type: 'complete'
        })
      )
    } catch {
      // Best effort.
    }
    this.cleanupSubscription(subscriptionId)
    return true
  }

  private cleanupSubscription(subscriptionId: string) {
    const entry = this.subscriptions.get(subscriptionId)
    if (!entry) {
      return
    }
    this.subscriptions.delete(subscriptionId)
    try {
      entry.socket.close()
    } catch {
      // noop
    }
  }

  private emitSubscriptionEvent(event: ServiceSubscriptionEvent) {
    const entry = this.subscriptions.get(event.subscriptionId)
    if (!entry) {
      return
    }
    const target = webContents.fromId(entry.webContentsId)
    if (!target || target.isDestroyed()) {
      this.cleanupSubscription(event.subscriptionId)
      return
    }
    target.send('services:subscription-event', ServiceSubscriptionEventSchema.parse(event))
  }

  async testConnection(id: string) {
    const service = await this.getService(id)
    if (!service) {
      throw new Error(`Unknown service "${id}".`)
    }

    try {
      if (service.kind === 'openapi') {
        const response = await fetch(service.endpoint, { method: 'GET' })
        return ServiceConnectionTestResultSchema.parse({
          ok: response.ok,
          status: response.status,
          message: response.ok ? 'OpenAPI endpoint reachable.' : response.statusText
        })
      }

      const response = await fetch(service.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'query ServiceHealthCheck { __typename }'
        })
      })
      return ServiceConnectionTestResultSchema.parse({
        ok: response.ok,
        status: response.status,
        message: response.ok ? 'GraphQL endpoint reachable.' : response.statusText
      })
    } catch (error) {
      return ServiceConnectionTestResultSchema.parse({
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

async function readResponseData(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export const serviceRegistryService = new ServiceRegistryService()
