import * as z from 'zod'

export const SERVICES_REGISTRY_VERSION = 1

export const ServiceKindSchema = z.enum(['openapi', 'graphql', 'supabase'])
export type ServiceKind = z.infer<typeof ServiceKindSchema>

export const ServiceImportSourceTypeSchema = z.enum(['url', 'file', 'text', 'introspection', 'sdl', 'manual'])
export type ServiceImportSourceType = z.infer<typeof ServiceImportSourceTypeSchema>

export const ServiceHeaderValueKindSchema = z.enum(['literal', 'secret'])
export type ServiceHeaderValueKind = z.infer<typeof ServiceHeaderValueKindSchema>

export const ServiceHeaderApplyToSchema = z.enum(['request', 'subscription-handshake', 'subscription-init'])
export type ServiceHeaderApplyTo = z.infer<typeof ServiceHeaderApplyToSchema>

export const ServiceSecretRefSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  updatedAt: z.string().optional()
})
export type ServiceSecretRef = z.infer<typeof ServiceSecretRefSchema>

export const ServiceHeaderValueTemplateSchema = z
  .object({
    kind: ServiceHeaderValueKindSchema,
    literal: z.string().optional(),
    secret: ServiceSecretRefSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'literal' && !value.literal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Literal header values require a literal string.'
      })
    }

    if (value.kind === 'secret' && !value.secret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Secret header values require a secret reference.'
      })
    }
  })
export type ServiceHeaderValueTemplate = z.infer<typeof ServiceHeaderValueTemplateSchema>

export const ServiceHeaderTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  applyTo: z.array(ServiceHeaderApplyToSchema).default(['request']),
  value: ServiceHeaderValueTemplateSchema
})
export type ServiceHeaderTemplate = z.infer<typeof ServiceHeaderTemplateSchema>

export const ServiceAuthSchemeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('none')
  }),
  z.object({
    type: z.literal('bearer'),
    headerName: z.string().default('Authorization'),
    scheme: z.string().default('Bearer'),
    token: ServiceSecretRefSchema
  }),
  z.object({
    type: z.literal('api-key'),
    headerName: z.string().min(1),
    prefix: z.string().optional(),
    token: ServiceSecretRefSchema
  }),
  z.object({
    type: z.literal('basic'),
    headerName: z.string().default('Authorization'),
    username: ServiceSecretRefSchema,
    password: ServiceSecretRefSchema
  })
])
export type ServiceAuthScheme = z.infer<typeof ServiceAuthSchemeSchema>

export const ServiceToolProjectionKindSchema = z.enum([
  'openapi-operation',
  'graphql-query',
  'graphql-mutation',
  'supabase-rest'
])
export type ServiceToolProjectionKind = z.infer<typeof ServiceToolProjectionKindSchema>

export const GraphQLServiceOperationTypeSchema = z.enum(['query', 'mutation', 'subscription'])
export type GraphQLServiceOperationType = z.infer<typeof GraphQLServiceOperationTypeSchema>

export const GraphQLSubscriptionTransportSchema = z.enum(['graphql-ws', 'sse', 'http-multipart'])
export type GraphQLSubscriptionTransport = z.infer<typeof GraphQLSubscriptionTransportSchema>

export const JsonSchemaLikeSchema = z.record(z.string(), z.unknown()).default({})
export type JsonSchemaLike = z.infer<typeof JsonSchemaLikeSchema>

export const ServiceImportSourceSchema = z.object({
  type: ServiceImportSourceTypeSchema,
  locator: z.string().optional(),
  importedAt: z.string().optional()
})
export type ServiceImportSource = z.infer<typeof ServiceImportSourceSchema>

export const ServiceRefreshMetadataSchema = z.object({
  lastImportedAt: z.string().optional(),
  lastRefreshedAt: z.string().optional(),
  importHash: z.string().optional()
})
export type ServiceRefreshMetadata = z.infer<typeof ServiceRefreshMetadataSchema>

export const ServiceToolProjectionSchema = z.object({
  id: z.string().min(1),
  kind: ServiceToolProjectionKindSchema,
  sourceOperationId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  inputSchema: JsonSchemaLikeSchema,
  additionalHeaders: z.array(ServiceHeaderTemplateSchema).default([])
})
export type ServiceToolProjection = z.infer<typeof ServiceToolProjectionSchema>

export const OpenAPIServiceOperationSchema = z.object({
  id: z.string().min(1),
  method: z.enum(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']),
  path: z.string().min(1),
  operationId: z.string().min(1),
  summary: z.string().optional(),
  description: z.string().optional(),
  inputSchema: JsonSchemaLikeSchema,
  security: z.array(z.record(z.string(), z.array(z.string()))).default([])
})
export type OpenAPIServiceOperation = z.infer<typeof OpenAPIServiceOperationSchema>

export const GraphQLServiceOperationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  operationType: GraphQLServiceOperationTypeSchema,
  description: z.string().optional(),
  text: z.string().min(1),
  variablesSchema: JsonSchemaLikeSchema,
  projected: z.boolean().default(false),
  projectionName: z.string().optional()
})
export type GraphQLServiceOperation = z.infer<typeof GraphQLServiceOperationSchema>

export const SupabaseServiceOperationSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('rest'),
  pathPrefix: z.string().min(1).default('/rest/v1'),
  description: z.string().optional(),
  inputSchema: JsonSchemaLikeSchema
})
export type SupabaseServiceOperation = z.infer<typeof SupabaseServiceOperationSchema>

const BaseServiceDefinitionSchema = z.object({
  serviceId: z.string().min(1),
  name: z.string().min(1),
  kind: ServiceKindSchema,
  endpoint: z.string().url(),
  subscriptionEndpoint: z.string().url().optional(),
  importSource: ServiceImportSourceSchema,
  auth: ServiceAuthSchemeSchema.default({ type: 'none' }),
  headerTemplates: z.array(ServiceHeaderTemplateSchema).default([]),
  projectedTools: z.array(ServiceToolProjectionSchema).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  refresh: ServiceRefreshMetadataSchema.default({}),
  metadata: z
    .object({
      title: z.string().optional(),
      version: z.string().optional()
    })
    .default({})
})

export const OpenAPIServiceDefinitionSchema = BaseServiceDefinitionSchema.extend({
  kind: z.literal('openapi'),
  serverUrls: z.array(z.string().url()).default([]),
  specSnapshot: z.string().min(1),
  operations: z.array(OpenAPIServiceOperationSchema).default([])
})
export type OpenAPIServiceDefinition = z.infer<typeof OpenAPIServiceDefinitionSchema>

export const GraphQLServiceDefinitionSchema = BaseServiceDefinitionSchema.extend({
  kind: z.literal('graphql'),
  schemaSnapshot: z.string().min(1),
  subscriptionTransport: GraphQLSubscriptionTransportSchema.default('graphql-ws'),
  operations: z.array(GraphQLServiceOperationSchema).default([])
})
export type GraphQLServiceDefinition = z.infer<typeof GraphQLServiceDefinitionSchema>

export const SupabaseServiceDefinitionSchema = BaseServiceDefinitionSchema.extend({
  kind: z.literal('supabase'),
  anonKey: ServiceSecretRefSchema,
  serviceRoleKey: ServiceSecretRefSchema.optional(),
  operations: z.array(SupabaseServiceOperationSchema).default([])
})
export type SupabaseServiceDefinition = z.infer<typeof SupabaseServiceDefinitionSchema>

export const ServiceDefinitionSchema = z.discriminatedUnion('kind', [
  OpenAPIServiceDefinitionSchema,
  GraphQLServiceDefinitionSchema,
  SupabaseServiceDefinitionSchema
])
export type ServiceDefinition = z.infer<typeof ServiceDefinitionSchema>

export const ServiceRegistryFileSchema = z.object({
  version: z.literal(SERVICES_REGISTRY_VERSION).default(SERVICES_REGISTRY_VERSION),
  services: z.array(ServiceDefinitionSchema).default([])
})
export type ServiceRegistryFile = z.infer<typeof ServiceRegistryFileSchema>

export const ServiceListQuerySchema = z.object({
  search: z.string().optional(),
  kind: ServiceKindSchema.optional()
})
export type ServiceListQuery = z.infer<typeof ServiceListQuerySchema>

export const SecretInputSchema = z.object({
  label: z.string().optional(),
  value: z.string().min(1)
})
export type SecretInput = z.infer<typeof SecretInputSchema>

export const HeaderTemplateInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  applyTo: z.array(ServiceHeaderApplyToSchema).default(['request']),
  literal: z.string().optional(),
  secret: SecretInputSchema.optional()
})
export type HeaderTemplateInput = z.infer<typeof HeaderTemplateInputSchema>

export const ServiceAuthInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('none')
  }),
  z.object({
    type: z.literal('bearer'),
    headerName: z.string().default('Authorization'),
    scheme: z.string().default('Bearer'),
    token: SecretInputSchema
  }),
  z.object({
    type: z.literal('api-key'),
    headerName: z.string().min(1),
    prefix: z.string().optional(),
    token: SecretInputSchema
  }),
  z.object({
    type: z.literal('basic'),
    headerName: z.string().default('Authorization'),
    username: SecretInputSchema,
    password: SecretInputSchema
  })
])
export type ServiceAuthInput = z.infer<typeof ServiceAuthInputSchema>

export const ImportOpenAPIServiceRequestSchema = z.object({
  serviceId: z.string().optional(),
  name: z.string().min(1),
  sourceType: z.enum(['url', 'file', 'text']),
  source: z.string().min(1),
  endpoint: z.string().url().optional(),
  auth: ServiceAuthInputSchema.default({ type: 'none' }),
  headerTemplates: z.array(HeaderTemplateInputSchema).default([])
})
export type ImportOpenAPIServiceRequest = z.infer<typeof ImportOpenAPIServiceRequestSchema>

export const ImportGraphQLServiceRequestSchema = z.object({
  serviceId: z.string().optional(),
  name: z.string().min(1),
  endpoint: z.string().url(),
  subscriptionEndpoint: z.string().url().optional(),
  sourceType: z.enum(['introspection', 'sdl']),
  source: z.string().optional(),
  auth: ServiceAuthInputSchema.default({ type: 'none' }),
  headerTemplates: z.array(HeaderTemplateInputSchema).default([]),
  subscriptionTransport: GraphQLSubscriptionTransportSchema.default('graphql-ws')
})
export type ImportGraphQLServiceRequest = z.infer<typeof ImportGraphQLServiceRequestSchema>

export const ImportSupabaseServiceRequestSchema = z.object({
  serviceId: z.string().optional(),
  name: z.string().min(1),
  endpoint: z.string().url(),
  anonKey: SecretInputSchema,
  serviceRoleKey: SecretInputSchema.optional(),
  headerTemplates: z.array(HeaderTemplateInputSchema).default([])
})
export type ImportSupabaseServiceRequest = z.infer<typeof ImportSupabaseServiceRequestSchema>

export const ServiceMetadataPatchSchema = z.object({
  name: z.string().min(1).optional(),
  endpoint: z.string().url().optional(),
  subscriptionEndpoint: z.string().url().optional(),
  auth: ServiceAuthInputSchema.optional(),
  headerTemplates: z.array(HeaderTemplateInputSchema).optional(),
  projectedTools: z.array(ServiceToolProjectionSchema).optional(),
  graphqlOperations: z.array(GraphQLServiceOperationSchema).optional()
})
export type ServiceMetadataPatch = z.infer<typeof ServiceMetadataPatchSchema>

export const UpdateServiceMetadataRequestSchema = z.object({
  id: z.string().min(1),
  patch: ServiceMetadataPatchSchema
})
export type UpdateServiceMetadataRequest = z.infer<typeof UpdateServiceMetadataRequestSchema>

export const ServiceToolSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  inputSchema: JsonSchemaLikeSchema,
  projectionKind: ServiceToolProjectionKindSchema
})
export type ServiceToolSummary = z.infer<typeof ServiceToolSummarySchema>

export const InvokeServiceToolRequestSchema = z.object({
  toolId: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({})
})
export type InvokeServiceToolRequest = z.infer<typeof InvokeServiceToolRequestSchema>

export const InvokeServiceOperationRequestSchema = z.object({
  serviceId: z.string().min(1),
  operationId: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({})
})
export type InvokeServiceOperationRequest = z.infer<typeof InvokeServiceOperationRequestSchema>

export const InvokeServiceResponseSchema = z.object({
  ok: z.boolean(),
  status: z.number().default(200),
  data: z.unknown().optional(),
  headers: z.record(z.string(), z.string()).default({})
})
export type InvokeServiceResponse = z.infer<typeof InvokeServiceResponseSchema>

export const SubscribeServiceOperationRequestSchema = z.object({
  serviceId: z.string().min(1),
  operationId: z.string().min(1),
  variables: z.record(z.string(), z.unknown()).default({})
})
export type SubscribeServiceOperationRequest = z.infer<typeof SubscribeServiceOperationRequestSchema>

export const ServiceSubscriptionEventSchema = z.object({
  subscriptionId: z.string().min(1),
  kind: z.enum(['ack', 'next', 'error', 'complete']),
  payload: z.unknown().optional()
})
export type ServiceSubscriptionEvent = z.infer<typeof ServiceSubscriptionEventSchema>

export const ServiceConnectionTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  status: z.number().optional()
})
export type ServiceConnectionTestResult = z.infer<typeof ServiceConnectionTestResultSchema>

export function buildServiceToolId(serviceId: string, toolId: string): string {
  return `service__${serviceId}__${toolId}`
}

export function isServiceToolId(toolId: string | null | undefined): boolean {
  return typeof toolId === 'string' && toolId.startsWith('service__')
}

export function buildOpenAPIOperationId(method: string, path: string): string {
  return `${method.toLowerCase()}__${path
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9/]+/g, '_')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\//g, '__')}`
}
