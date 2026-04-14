import { useTheme } from '@renderer/context/ThemeProvider'
import { useServices } from '@renderer/hooks/useServices'
import type {
  GraphQLServiceOperation,
  GraphQLServiceOperationType,
  HeaderTemplateInput,
  ImportGraphQLServiceRequest,
  ImportOpenAPIServiceRequest,
  ImportSupabaseServiceRequest,
  ServiceAuthInput,
  ServiceDefinition,
  ServiceKind,
  ServiceToolProjection
} from '@shared/services'
import { Button, Card, Checkbox, Input, Modal, Select, Space, Tag } from 'antd'
import { Plus, RefreshCw, TestTube2, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDescription, SettingDivider, SettingGroup, SettingTitle } from '..'

type AuthDraft =
  | { type: 'none' }
  | { type: 'bearer'; headerName: string; scheme: string; tokenLabel: string; tokenValue: string }
  | { type: 'api-key'; headerName: string; prefix: string; tokenLabel: string; tokenValue: string }
  | {
      type: 'basic'
      headerName: string
      usernameLabel: string
      usernameValue: string
      passwordLabel: string
      passwordValue: string
    }

type HeaderDraft = {
  id: string
  name: string
  mode: 'literal' | 'secret'
  value: string
  label: string
  applyTo: Array<'request' | 'subscription-handshake' | 'subscription-init'>
}

type GraphQLOperationDraft = {
  id: string
  name: string
  operationType: GraphQLServiceOperationType
  description: string
  text: string
  projected: boolean
  projectionName: string
}

type OpenApiImportDraft = {
  name: string
  sourceType: 'url' | 'file' | 'text'
  source: string
  endpoint: string
  auth: AuthDraft
  headers: HeaderDraft[]
}

type GraphqlImportDraft = {
  name: string
  endpoint: string
  subscriptionEndpoint: string
  sourceType: 'introspection' | 'sdl'
  source: string
  auth: AuthDraft
  headers: HeaderDraft[]
  operations: GraphQLOperationDraft[]
}

type SupabaseImportDraft = {
  name: string
  projectUrl: string
  databaseSchema: string
  anonKeyLabel: string
  anonKeyValue: string
  serviceKeyLabel: string
  serviceKeyValue: string
  tables: string
  rpcFunctions: string
  storageBuckets: string
  enableAuth: boolean
  headers: HeaderDraft[]
}

const createEmptyOpenApiImport = (): OpenApiImportDraft => ({
  name: '',
  sourceType: 'url',
  source: '',
  endpoint: '',
  auth: { type: 'none' },
  headers: []
})

const createEmptyGraphqlImport = (): GraphqlImportDraft => ({
  name: '',
  endpoint: '',
  subscriptionEndpoint: '',
  sourceType: 'introspection',
  source: '',
  auth: { type: 'none' },
  headers: [],
  operations: []
})

const createEmptySupabaseImport = (): SupabaseImportDraft => ({
  name: '',
  projectUrl: '',
  databaseSchema: 'public',
  anonKeyLabel: 'Supabase anon key',
  anonKeyValue: '',
  serviceKeyLabel: 'Supabase service role key',
  serviceKeyValue: '',
  tables: '',
  rpcFunctions: '',
  storageBuckets: '',
  enableAuth: true,
  headers: []
})

const createHeaderDraft = (): HeaderDraft => ({
  id: `header-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  name: '',
  mode: 'literal',
  value: '',
  label: '',
  applyTo: ['request']
})

const createOperationDraft = (): GraphQLOperationDraft => ({
  id: `graphql-op-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  name: '',
  operationType: 'query',
  description: '',
  text: '',
  projected: true,
  projectionName: ''
})

function parseListInput(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function toAuthInput(auth: AuthDraft): ServiceAuthInput {
  switch (auth.type) {
    case 'none':
      return { type: 'none' }
    case 'bearer':
      return {
        type: 'bearer',
        headerName: auth.headerName || 'Authorization',
        scheme: auth.scheme || 'Bearer',
        token: {
          label: auth.tokenLabel || 'Bearer token',
          value: auth.tokenValue
        }
      }
    case 'api-key':
      return {
        type: 'api-key',
        headerName: auth.headerName,
        prefix: auth.prefix || undefined,
        token: {
          label: auth.tokenLabel || auth.headerName,
          value: auth.tokenValue
        }
      }
    case 'basic':
      return {
        type: 'basic',
        headerName: auth.headerName || 'Authorization',
        username: {
          label: auth.usernameLabel || 'Basic username',
          value: auth.usernameValue
        },
        password: {
          label: auth.passwordLabel || 'Basic password',
          value: auth.passwordValue
        }
      }
  }
}

function toHeaderInputs(headers: HeaderDraft[]): HeaderTemplateInput[] {
  return headers
    .filter((header) => header.name.trim() && header.value.trim())
    .map((header) => ({
      id: header.id,
      name: header.name.trim(),
      enabled: true,
      applyTo: header.applyTo,
      literal: header.mode === 'literal' ? header.value : undefined,
      secret:
        header.mode === 'secret'
          ? {
              label: header.label || header.name,
              value: header.value
            }
          : undefined
    }))
}

function toGraphqlOperations(operations: GraphQLOperationDraft[]): GraphQLServiceOperation[] {
  return operations
    .filter((operation) => operation.name.trim() && operation.text.trim())
    .map((operation) => ({
      id: operation.id,
      name: operation.name.trim(),
      operationType: operation.operationType,
      description: operation.description.trim() || undefined,
      text: operation.text,
      variablesSchema: {},
      projected: operation.projected,
      projectionName: operation.projectionName.trim() || undefined
    }))
}

function mapGraphqlOperations(service: ServiceDefinition): GraphQLOperationDraft[] {
  if (service.kind !== 'graphql') {
    return []
  }

  return service.operations.map((operation) => ({
    id: operation.id,
    name: operation.name,
    operationType: operation.operationType,
    description: operation.description ?? '',
    text: operation.text,
    projected: operation.projected,
    projectionName: operation.projectionName ?? ''
  }))
}

function mapProjectedTools(service: ServiceDefinition): ServiceToolProjection[] {
  return service.projectedTools.map((tool) => ({ ...tool }))
}

const ServicesSettings = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { services, loading, importOpenAPI, importGraphQL, importSupabase, updateService, deleteService, reload } =
    useServices()
  const [importKind, setImportKind] = useState<ServiceKind>('openapi')
  const [openApiDraft, setOpenApiDraft] = useState(createEmptyOpenApiImport())
  const [graphqlDraft, setGraphqlDraft] = useState(createEmptyGraphqlImport())
  const [supabaseDraft, setSupabaseDraft] = useState(createEmptySupabaseImport())
  const [editingService, setEditingService] = useState<ServiceDefinition | null>(null)
  const [editingProjectedTools, setEditingProjectedTools] = useState<ServiceToolProjection[]>([])
  const [editingGraphqlOperations, setEditingGraphqlOperations] = useState<GraphQLOperationDraft[]>([])
  const [healthState, setHealthState] = useState<Record<string, string>>({})

  const registryCards = useMemo(
    () =>
      services.map((service) => {
        const projectedCount = service.projectedTools.filter((tool) => tool.enabled).length
        const subscriptionCount =
          service.kind === 'graphql'
            ? service.operations.filter((operation) => operation.operationType === 'subscription').length
            : 0

        return (
          <Card
            key={service.serviceId}
            className='border border-default-200'
            title={
              <CardHeader>
                <div>
                  <CardTitle>{service.name}</CardTitle>
                  <CardMeta>
                    <Tag>{service.kind}</Tag>
                    <span>{service.endpoint}</span>
                  </CardMeta>
                </div>
                <Space wrap>
                  <Button
                    size='small'
                    icon={<TestTube2 size={14} />}
                    onClick={async () => {
                      const result = await window.api.services.testConnection(service.serviceId)
                      setHealthState((prev) => ({
                        ...prev,
                        [service.serviceId]: result.ok
                          ? `Healthy${result.status ? ` (${result.status})` : ''}`
                          : result.message || 'Unreachable'
                      }))
                    }}>
                    {t('settings.services.test', 'Test')}
                  </Button>
                  <Button
                    size='small'
                    onClick={() => {
                      setEditingService(service)
                      setEditingProjectedTools(mapProjectedTools(service))
                      setEditingGraphqlOperations(mapGraphqlOperations(service))
                    }}>
                    {t('common.edit', 'Edit')}
                  </Button>
                  <Button
                    danger
                    size='small'
                    icon={<Trash2 size={14} />}
                    onClick={() => void deleteService(service.serviceId)}>
                    {t('common.delete', 'Delete')}
                  </Button>
                </Space>
              </CardHeader>
            }>
            <CardMeta>
              <span>
                {t('settings.services.projectedCount', {
                  defaultValue: '{{count}} projected tools',
                  count: projectedCount
                })}
              </span>
              {service.kind === 'graphql' ? (
                <span>
                  {t('settings.services.subscriptionCount', {
                    defaultValue: '{{count}} subscriptions',
                    count: subscriptionCount
                  })}
                </span>
              ) : null}
              {service.kind === 'supabase' ? <span>{service.databaseSchema}</span> : null}
              <span>
                {t('settings.services.headerCount', {
                  defaultValue: '{{count}} header templates',
                  count: service.headerTemplates.length
                })}
              </span>
              <span>{t('settings.services.authType', { defaultValue: 'Auth: {{type}}', type: service.auth.type })}</span>
              {healthState[service.serviceId] ? <Tag color='processing'>{healthState[service.serviceId]}</Tag> : null}
            </CardMeta>
          </Card>
        )
      }),
    [deleteService, healthState, services, t]
  )

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.services.title', 'Services')}</SettingTitle>
        <SettingDescription>
          {t(
            'settings.services.description',
            'Import and curate shared external interfaces once, then reuse their projected tools across assistants, agents, and artifacts.'
          )}
        </SettingDescription>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.services.registryTitle', 'Registry')}</SettingTitle>
        <SettingDescription>
          {t(
            'settings.services.registryDescription',
            'Review each shared service, test connectivity, and edit which operations project into the shared tool surface.'
          )}
        </SettingDescription>
        <SettingDivider />
        <ToolbarRow>
          <Button icon={<RefreshCw size={14} />} onClick={() => void reload()} loading={loading}>
            {t('common.refresh', 'Refresh')}
          </Button>
        </ToolbarRow>
        <CardsColumn>
          {registryCards.length > 0 ? (
            registryCards
          ) : (
            <EmptyState>{t('settings.services.empty', 'No services registered yet.')}</EmptyState>
          )}
        </CardsColumn>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.services.addTitle', 'Add Service')}</SettingTitle>
        <SettingDescription>
          {t(
            'settings.services.addDescription',
            'Pick a service type, capture credentials once, and decide which operations should appear as reusable shared tools.'
          )}
        </SettingDescription>
        <SettingDivider />
        <SectionLabel>{t('settings.services.kindLabel', 'Service type')}</SectionLabel>
        <Select
          value={importKind}
          style={{ width: 240 }}
          options={[
            { label: 'OpenAPI', value: 'openapi' },
            { label: 'GraphQL', value: 'graphql' },
            { label: 'Supabase', value: 'supabase' }
          ]}
          onChange={(value) => setImportKind(value)}
        />
        <SettingDivider />

        {importKind === 'openapi' ? (
          <FormCard>
            <Space direction='vertical' style={{ width: '100%' }} size={12}>
              <Input
                placeholder={t('settings.services.namePlaceholder', 'Display name')}
                value={openApiDraft.name}
                onChange={(event) => setOpenApiDraft((prev) => ({ ...prev, name: event.target.value }))}
              />
              <Select
                value={openApiDraft.sourceType}
                options={[
                  { label: t('settings.services.openapiSourceUrl', 'Spec URL'), value: 'url' },
                  { label: t('settings.services.openapiSourceFile', 'Local file'), value: 'file' },
                  { label: t('settings.services.openapiSourceText', 'Pasted JSON/YAML'), value: 'text' }
                ]}
                onChange={(value) => setOpenApiDraft((prev) => ({ ...prev, sourceType: value }))}
              />
              <Input.TextArea
                rows={6}
                placeholder={
                  openApiDraft.sourceType === 'text'
                    ? t('settings.services.openapiPaste', 'Paste OpenAPI 3.x JSON or YAML')
                    : t('settings.services.openapiLocator', 'Enter the spec URL or local file path')
                }
                value={openApiDraft.source}
                onChange={(event) => setOpenApiDraft((prev) => ({ ...prev, source: event.target.value }))}
              />
              <Input
                placeholder={t('settings.services.openapiEndpoint', 'Endpoint override (optional)')}
                value={openApiDraft.endpoint}
                onChange={(event) => setOpenApiDraft((prev) => ({ ...prev, endpoint: event.target.value }))}
              />
              <AuthEditor auth={openApiDraft.auth} onChange={(auth) => setOpenApiDraft((prev) => ({ ...prev, auth }))} />
              <HeaderEditor
                headers={openApiDraft.headers}
                onChange={(headers) => setOpenApiDraft((prev) => ({ ...prev, headers }))}
              />
              <Button
                type='primary'
                onClick={async () => {
                  const request: ImportOpenAPIServiceRequest = {
                    name: openApiDraft.name,
                    sourceType: openApiDraft.sourceType,
                    source: openApiDraft.source,
                    endpoint: openApiDraft.endpoint || undefined,
                    auth: toAuthInput(openApiDraft.auth),
                    headerTemplates: toHeaderInputs(openApiDraft.headers)
                  }
                  await importOpenAPI(request)
                  setOpenApiDraft(createEmptyOpenApiImport())
                }}>
                {t('settings.services.importOpenApi', 'Import OpenAPI Service')}
              </Button>
            </Space>
          </FormCard>
        ) : null}

        {importKind === 'graphql' ? (
          <FormCard>
            <Space direction='vertical' style={{ width: '100%' }} size={12}>
              <Input
                placeholder={t('settings.services.namePlaceholder', 'Display name')}
                value={graphqlDraft.name}
                onChange={(event) => setGraphqlDraft((prev) => ({ ...prev, name: event.target.value }))}
              />
              <Input
                placeholder={t('settings.services.graphqlEndpoint', 'GraphQL endpoint')}
                value={graphqlDraft.endpoint}
                onChange={(event) => setGraphqlDraft((prev) => ({ ...prev, endpoint: event.target.value }))}
              />
              <Input
                placeholder={t('settings.services.graphqlSubscriptionEndpoint', 'Subscription endpoint (optional)')}
                value={graphqlDraft.subscriptionEndpoint}
                onChange={(event) =>
                  setGraphqlDraft((prev) => ({ ...prev, subscriptionEndpoint: event.target.value }))
                }
              />
              <Select
                value={graphqlDraft.sourceType}
                options={[
                  { label: t('settings.services.graphqlIntrospection', 'Schema introspection'), value: 'introspection' },
                  { label: t('settings.services.graphqlSdl', 'Pasted SDL'), value: 'sdl' }
                ]}
                onChange={(value) => setGraphqlDraft((prev) => ({ ...prev, sourceType: value }))}
              />
              {graphqlDraft.sourceType === 'sdl' ? (
                <Input.TextArea
                  rows={6}
                  placeholder={t('settings.services.graphqlPasteSdl', 'Paste GraphQL SDL')}
                  value={graphqlDraft.source}
                  onChange={(event) => setGraphqlDraft((prev) => ({ ...prev, source: event.target.value }))}
                />
              ) : null}
              <AuthEditor auth={graphqlDraft.auth} onChange={(auth) => setGraphqlDraft((prev) => ({ ...prev, auth }))} />
              <HeaderEditor
                headers={graphqlDraft.headers}
                onChange={(headers) => setGraphqlDraft((prev) => ({ ...prev, headers }))}
              />
              <SectionLabel>{t('settings.services.savedOperations', 'Saved operations')}</SectionLabel>
              {graphqlDraft.operations.map((operation, index) => (
                <OperationCard key={operation.id}>
                  <Space direction='vertical' style={{ width: '100%' }}>
                    <Input
                      placeholder={t('settings.services.operationName', 'Operation name')}
                      value={operation.name}
                      onChange={(event) =>
                        setGraphqlDraft((prev) => ({
                          ...prev,
                          operations: prev.operations.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, name: event.target.value } : entry
                          )
                        }))
                      }
                    />
                    <Select
                      value={operation.operationType}
                      options={[
                        { label: t('settings.services.query', 'Query'), value: 'query' },
                        { label: t('settings.services.mutation', 'Mutation'), value: 'mutation' },
                        { label: t('settings.services.subscription', 'Subscription'), value: 'subscription' }
                      ]}
                      onChange={(value) =>
                        setGraphqlDraft((prev) => ({
                          ...prev,
                          operations: prev.operations.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, operationType: value } : entry
                          )
                        }))
                      }
                    />
                    <Input
                      placeholder={t('settings.services.projectionName', 'Projection name (optional)')}
                      value={operation.projectionName}
                      onChange={(event) =>
                        setGraphqlDraft((prev) => ({
                          ...prev,
                          operations: prev.operations.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, projectionName: event.target.value } : entry
                          )
                        }))
                      }
                    />
                    <Input.TextArea
                      rows={6}
                      placeholder={t('settings.services.operationText', 'Operation text')}
                      value={operation.text}
                      onChange={(event) =>
                        setGraphqlDraft((prev) => ({
                          ...prev,
                          operations: prev.operations.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, text: event.target.value } : entry
                          )
                        }))
                      }
                    />
                    <Checkbox
                      checked={operation.projected}
                      onChange={(event) =>
                        setGraphqlDraft((prev) => ({
                          ...prev,
                          operations: prev.operations.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, projected: event.target.checked } : entry
                          )
                        }))
                      }>
                      {t('settings.services.projectOperation', 'Project as reusable tool')}
                    </Checkbox>
                  </Space>
                </OperationCard>
              ))}
              <Button
                icon={<Plus size={14} />}
                onClick={() =>
                  setGraphqlDraft((prev) => ({
                    ...prev,
                    operations: [...prev.operations, createOperationDraft()]
                  }))
                }>
                {t('settings.services.addOperation', 'Add GraphQL Operation')}
              </Button>
              <Button
                type='primary'
                onClick={async () => {
                  const request: ImportGraphQLServiceRequest = {
                    name: graphqlDraft.name,
                    endpoint: graphqlDraft.endpoint,
                    subscriptionEndpoint: graphqlDraft.subscriptionEndpoint || undefined,
                    sourceType: graphqlDraft.sourceType,
                    source: graphqlDraft.sourceType === 'sdl' ? graphqlDraft.source : undefined,
                    auth: toAuthInput(graphqlDraft.auth),
                    headerTemplates: toHeaderInputs(graphqlDraft.headers),
                    subscriptionTransport: 'graphql-ws'
                  }
                  const service = await importGraphQL(request)
                  const operations = toGraphqlOperations(graphqlDraft.operations)
                  if (operations.length > 0) {
                    await updateService(service.serviceId, { graphqlOperations: operations })
                  }
                  setGraphqlDraft(createEmptyGraphqlImport())
                }}>
                {t('settings.services.saveGraphql', 'Save GraphQL Service')}
              </Button>
            </Space>
          </FormCard>
        ) : null}

        {importKind === 'supabase' ? (
          <FormCard>
            <Space direction='vertical' style={{ width: '100%' }} size={12}>
              <Input
                placeholder={t('settings.services.namePlaceholder', 'Display name')}
                value={supabaseDraft.name}
                onChange={(event) => setSupabaseDraft((prev) => ({ ...prev, name: event.target.value }))}
              />
              <Input
                placeholder={t('settings.services.supabaseProjectUrl', 'Project URL')}
                value={supabaseDraft.projectUrl}
                onChange={(event) => setSupabaseDraft((prev) => ({ ...prev, projectUrl: event.target.value }))}
              />
              <Input
                placeholder={t('settings.services.supabaseSchema', 'Database schema')}
                value={supabaseDraft.databaseSchema}
                onChange={(event) => setSupabaseDraft((prev) => ({ ...prev, databaseSchema: event.target.value }))}
              />
              <FieldGrid>
                <Input
                  placeholder={t('settings.services.secretLabel', 'Secret label')}
                  value={supabaseDraft.anonKeyLabel}
                  onChange={(event) => setSupabaseDraft((prev) => ({ ...prev, anonKeyLabel: event.target.value }))}
                />
                <Input.Password
                  placeholder={t('settings.services.supabaseAnonKey', 'Anon key')}
                  value={supabaseDraft.anonKeyValue}
                  onChange={(event) => setSupabaseDraft((prev) => ({ ...prev, anonKeyValue: event.target.value }))}
                />
              </FieldGrid>
              <FieldGrid>
                <Input
                  placeholder={t('settings.services.secretLabel', 'Secret label')}
                  value={supabaseDraft.serviceKeyLabel}
                  onChange={(event) => setSupabaseDraft((prev) => ({ ...prev, serviceKeyLabel: event.target.value }))}
                />
                <Input.Password
                  placeholder={t('settings.services.supabaseServiceKey', 'Service role key (optional)')}
                  value={supabaseDraft.serviceKeyValue}
                  onChange={(event) => setSupabaseDraft((prev) => ({ ...prev, serviceKeyValue: event.target.value }))}
                />
              </FieldGrid>
              <Input.TextArea
                rows={3}
                placeholder={t(
                  'settings.services.supabaseTables',
                  'Tables to scaffold as tools, comma-separated (for example: profiles, orders, invoices)'
                )}
                value={supabaseDraft.tables}
                onChange={(event) => setSupabaseDraft((prev) => ({ ...prev, tables: event.target.value }))}
              />
              <Input.TextArea
                rows={3}
                placeholder={t(
                  'settings.services.supabaseRpc',
                  'RPC functions to scaffold as tools, comma-separated'
                )}
                value={supabaseDraft.rpcFunctions}
                onChange={(event) => setSupabaseDraft((prev) => ({ ...prev, rpcFunctions: event.target.value }))}
              />
              <Input.TextArea
                rows={3}
                placeholder={t(
                  'settings.services.supabaseBuckets',
                  'Storage buckets to scaffold as tools, comma-separated'
                )}
                value={supabaseDraft.storageBuckets}
                onChange={(event) => setSupabaseDraft((prev) => ({ ...prev, storageBuckets: event.target.value }))}
              />
              <Checkbox
                checked={supabaseDraft.enableAuth}
                onChange={(event) => setSupabaseDraft((prev) => ({ ...prev, enableAuth: event.target.checked }))}>
                {t('settings.services.supabaseAuthToggle', 'Include Supabase Auth helper tools')}
              </Checkbox>
              <HeaderEditor
                headers={supabaseDraft.headers}
                onChange={(headers) => setSupabaseDraft((prev) => ({ ...prev, headers }))}
              />
              <Button
                type='primary'
                onClick={async () => {
                  const request: ImportSupabaseServiceRequest = {
                    name: supabaseDraft.name,
                    projectUrl: supabaseDraft.projectUrl,
                    databaseSchema: supabaseDraft.databaseSchema || 'public',
                    anonKey: {
                      label: supabaseDraft.anonKeyLabel || 'Supabase anon key',
                      value: supabaseDraft.anonKeyValue
                    },
                    serviceKey: supabaseDraft.serviceKeyValue
                      ? {
                          label: supabaseDraft.serviceKeyLabel || 'Supabase service role key',
                          value: supabaseDraft.serviceKeyValue
                        }
                      : undefined,
                    tables: parseListInput(supabaseDraft.tables),
                    rpcFunctions: parseListInput(supabaseDraft.rpcFunctions),
                    storageBuckets: parseListInput(supabaseDraft.storageBuckets),
                    enableAuth: supabaseDraft.enableAuth,
                    headerTemplates: toHeaderInputs(supabaseDraft.headers)
                  }
                  await importSupabase(request)
                  setSupabaseDraft(createEmptySupabaseImport())
                }}>
                {t('settings.services.importSupabase', 'Import Supabase Service')}
              </Button>
            </Space>
          </FormCard>
        ) : null}
      </SettingGroup>

      <Modal
        open={!!editingService}
        title={
          editingService
            ? t('settings.services.editTitle', {
                defaultValue: 'Edit {{name}}',
                name: editingService.name
              })
            : t('settings.services.editFallback', 'Edit service')
        }
        width={920}
        onCancel={() => {
          setEditingService(null)
          setEditingProjectedTools([])
          setEditingGraphqlOperations([])
        }}
        onOk={async () => {
          if (!editingService) {
            return
          }

          await updateService(editingService.serviceId, {
            name: editingService.name,
            endpoint: editingService.endpoint,
            subscriptionEndpoint: editingService.kind === 'graphql' ? editingService.subscriptionEndpoint : undefined,
            projectUrl: editingService.kind === 'supabase' ? editingService.projectUrl : undefined,
            databaseSchema: editingService.kind === 'supabase' ? editingService.databaseSchema : undefined,
            projectedTools:
              editingService.kind === 'openapi' || editingService.kind === 'supabase' ? editingProjectedTools : undefined,
            graphqlOperations:
              editingService.kind === 'graphql' ? toGraphqlOperations(editingGraphqlOperations) : undefined
          })
          setEditingService(null)
        }}
        destroyOnClose>
        {editingService ? (
          <Space direction='vertical' style={{ width: '100%' }} size={12}>
            <Input
              value={editingService.name}
              onChange={(event) => setEditingService((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
            />
            <Input
              value={editingService.kind === 'supabase' ? editingService.projectUrl : editingService.endpoint}
              onChange={(event) =>
                setEditingService((prev) =>
                  prev
                    ? prev.kind === 'supabase'
                      ? { ...prev, projectUrl: event.target.value, endpoint: event.target.value }
                      : { ...prev, endpoint: event.target.value }
                    : prev
                )
              }
            />
            {editingService.kind === 'graphql' ? (
              <Input
                placeholder={t('settings.services.graphqlSubscriptionEndpoint', 'Subscription endpoint (optional)')}
                value={editingService.subscriptionEndpoint ?? ''}
                onChange={(event) =>
                  setEditingService((prev) =>
                    prev && prev.kind === 'graphql'
                      ? { ...prev, subscriptionEndpoint: event.target.value || undefined }
                      : prev
                  )
                }
              />
            ) : null}
            {editingService.kind === 'supabase' ? (
              <Input
                placeholder={t('settings.services.supabaseSchema', 'Database schema')}
                value={editingService.databaseSchema}
                onChange={(event) =>
                  setEditingService((prev) =>
                    prev && prev.kind === 'supabase' ? { ...prev, databaseSchema: event.target.value } : prev
                  )
                }
              />
            ) : null}
            <SettingDivider />
            <SectionLabel>{t('settings.services.authHeaders', 'Auth and headers')}</SectionLabel>
            <SettingDescription>
              {t(
                'settings.services.authHeadersHint',
                'Secrets stay managed through import. Re-import if you need to rotate secret-backed auth or header values.'
              )}
            </SettingDescription>
            <CardMeta>
              <span>
                {t('settings.services.authType', { defaultValue: 'Auth: {{type}}', type: editingService.auth.type })}
              </span>
              <span>
                {t('settings.services.headerCount', {
                  defaultValue: '{{count}} header templates',
                  count: editingService.headerTemplates.length
                })}
              </span>
            </CardMeta>
            <SettingDivider />
            {editingService.kind === 'graphql' ? (
              <>
                <SectionLabel>{t('settings.services.savedOperations', 'Saved operations')}</SectionLabel>
                {editingGraphqlOperations.map((operation, index) => (
                  <OperationCard key={operation.id}>
                    <Space direction='vertical' style={{ width: '100%' }}>
                      <Input
                        value={operation.name}
                        onChange={(event) =>
                          setEditingGraphqlOperations((prev) =>
                            prev.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, name: event.target.value } : entry
                            )
                          )
                        }
                      />
                      <Select
                        value={operation.operationType}
                        options={[
                          { label: t('settings.services.query', 'Query'), value: 'query' },
                          { label: t('settings.services.mutation', 'Mutation'), value: 'mutation' },
                          { label: t('settings.services.subscription', 'Subscription'), value: 'subscription' }
                        ]}
                        onChange={(value) =>
                          setEditingGraphqlOperations((prev) =>
                            prev.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, operationType: value } : entry
                            )
                          )
                        }
                      />
                      <Input
                        placeholder={t('settings.services.projectionName', 'Projection name (optional)')}
                        value={operation.projectionName}
                        onChange={(event) =>
                          setEditingGraphqlOperations((prev) =>
                            prev.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, projectionName: event.target.value } : entry
                            )
                          )
                        }
                      />
                      <Input.TextArea
                        rows={5}
                        value={operation.text}
                        onChange={(event) =>
                          setEditingGraphqlOperations((prev) =>
                            prev.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, text: event.target.value } : entry
                            )
                          )
                        }
                      />
                      <Checkbox
                        checked={operation.projected}
                        disabled={operation.operationType === 'subscription'}
                        onChange={(event) =>
                          setEditingGraphqlOperations((prev) =>
                            prev.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, projected: event.target.checked } : entry
                            )
                          )
                        }>
                        {t('settings.services.projectOperation', 'Project as reusable tool')}
                      </Checkbox>
                    </Space>
                  </OperationCard>
                ))}
                <Button icon={<Plus size={14} />} onClick={() => setEditingGraphqlOperations((prev) => [...prev, createOperationDraft()])}>
                  {t('settings.services.addOperation', 'Add GraphQL Operation')}
                </Button>
              </>
            ) : (
              <>
                <SectionLabel>{t('settings.services.toolProjection', 'Tool projection')}</SectionLabel>
                {editingProjectedTools.map((tool, index) => (
                  <OperationCard key={tool.id}>
                    <Space direction='vertical' style={{ width: '100%' }}>
                      <Input
                        value={tool.name}
                        onChange={(event) =>
                          setEditingProjectedTools((prev) =>
                            prev.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, name: event.target.value } : entry
                            )
                          )
                        }
                      />
                      <Input.TextArea
                        rows={2}
                        value={tool.description}
                        onChange={(event) =>
                          setEditingProjectedTools((prev) =>
                            prev.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, description: event.target.value } : entry
                            )
                          )
                        }
                      />
                      <CardMeta>
                        <Tag>{tool.kind}</Tag>
                        <span>{tool.sourceOperationId}</span>
                      </CardMeta>
                      <Checkbox
                        checked={tool.enabled}
                        onChange={(event) =>
                          setEditingProjectedTools((prev) =>
                            prev.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, enabled: event.target.checked } : entry
                            )
                          )
                        }>
                        {t('settings.services.exposeOperation', 'Expose this operation as a shared tool')}
                      </Checkbox>
                    </Space>
                  </OperationCard>
                ))}
              </>
            )}
          </Space>
        ) : null}
      </Modal>
    </SettingContainer>
  )
}

const AuthEditor = ({ auth, onChange }: { auth: AuthDraft; onChange: (auth: AuthDraft) => void }) => (
  <Section>
    <SectionLabel>Auth & Headers</SectionLabel>
    <Space direction='vertical' style={{ width: '100%' }} size={12}>
      <Select
        value={auth.type}
        options={[
          { label: 'No auth', value: 'none' },
          { label: 'Bearer / JWT', value: 'bearer' },
          { label: 'API key header', value: 'api-key' },
          { label: 'Basic auth', value: 'basic' }
        ]}
        onChange={(value) => {
          if (value === 'none') onChange({ type: 'none' })
          if (value === 'bearer')
            onChange({ type: 'bearer', headerName: 'Authorization', scheme: 'Bearer', tokenLabel: '', tokenValue: '' })
          if (value === 'api-key')
            onChange({ type: 'api-key', headerName: 'x-api-key', prefix: '', tokenLabel: '', tokenValue: '' })
          if (value === 'basic') {
            onChange({
              type: 'basic',
              headerName: 'Authorization',
              usernameLabel: '',
              usernameValue: '',
              passwordLabel: '',
              passwordValue: ''
            })
          }
        }}
      />
      {auth.type === 'bearer' ? (
        <Space direction='vertical' style={{ width: '100%' }}>
          <Input
            value={auth.headerName}
            placeholder='Header name'
            onChange={(event) => onChange({ ...auth, headerName: event.target.value })}
          />
          <Input value={auth.scheme} placeholder='Scheme' onChange={(event) => onChange({ ...auth, scheme: event.target.value })} />
          <Input
            value={auth.tokenLabel}
            placeholder='Secret label'
            onChange={(event) => onChange({ ...auth, tokenLabel: event.target.value })}
          />
          <Input.Password
            value={auth.tokenValue}
            placeholder='Secret value'
            onChange={(event) => onChange({ ...auth, tokenValue: event.target.value })}
          />
        </Space>
      ) : null}
      {auth.type === 'api-key' ? (
        <Space direction='vertical' style={{ width: '100%' }}>
          <Input
            value={auth.headerName}
            placeholder='Header name'
            onChange={(event) => onChange({ ...auth, headerName: event.target.value })}
          />
          <Input
            value={auth.prefix}
            placeholder='Prefix (optional)'
            onChange={(event) => onChange({ ...auth, prefix: event.target.value })}
          />
          <Input
            value={auth.tokenLabel}
            placeholder='Secret label'
            onChange={(event) => onChange({ ...auth, tokenLabel: event.target.value })}
          />
          <Input.Password
            value={auth.tokenValue}
            placeholder='Secret value'
            onChange={(event) => onChange({ ...auth, tokenValue: event.target.value })}
          />
        </Space>
      ) : null}
      {auth.type === 'basic' ? (
        <Space direction='vertical' style={{ width: '100%' }}>
          <Input
            value={auth.headerName}
            placeholder='Header name'
            onChange={(event) => onChange({ ...auth, headerName: event.target.value })}
          />
          <Input
            value={auth.usernameLabel}
            placeholder='Username label'
            onChange={(event) => onChange({ ...auth, usernameLabel: event.target.value })}
          />
          <Input
            value={auth.usernameValue}
            placeholder='Username'
            onChange={(event) => onChange({ ...auth, usernameValue: event.target.value })}
          />
          <Input
            value={auth.passwordLabel}
            placeholder='Password label'
            onChange={(event) => onChange({ ...auth, passwordLabel: event.target.value })}
          />
          <Input.Password
            value={auth.passwordValue}
            placeholder='Password'
            onChange={(event) => onChange({ ...auth, passwordValue: event.target.value })}
          />
        </Space>
      ) : null}
    </Space>
  </Section>
)

const HeaderEditor = ({
  headers,
  onChange
}: {
  headers: HeaderDraft[]
  onChange: (headers: HeaderDraft[]) => void
}) => (
  <Section>
    <SectionLabel>Custom Header Templates</SectionLabel>
    <Space direction='vertical' style={{ width: '100%' }} size={12}>
      {headers.map((header, index) => (
        <OperationCard key={header.id}>
          <Space direction='vertical' style={{ width: '100%' }}>
            <Input
              placeholder='Header name'
              value={header.name}
              onChange={(event) =>
                onChange(
                  headers.map((entry, entryIndex) =>
                    entryIndex === index ? { ...entry, name: event.target.value } : entry
                  )
                )
              }
            />
            <Select
              value={header.mode}
              options={[
                { label: 'Literal value', value: 'literal' },
                { label: 'Secret-backed value', value: 'secret' }
              ]}
              onChange={(value) =>
                onChange(headers.map((entry, entryIndex) => (entryIndex === index ? { ...entry, mode: value } : entry)))
              }
            />
            <Input
              placeholder={header.mode === 'literal' ? 'Header value' : 'Secret label'}
              value={header.mode === 'literal' ? header.value : header.label}
              onChange={(event) =>
                onChange(
                  headers.map((entry, entryIndex) =>
                    entryIndex === index
                      ? header.mode === 'literal'
                        ? { ...entry, value: event.target.value }
                        : { ...entry, label: event.target.value }
                      : entry
                  )
                )
              }
            />
            {header.mode === 'secret' ? (
              <Input.Password
                placeholder='Secret value'
                value={header.value}
                onChange={(event) =>
                  onChange(
                    headers.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, value: event.target.value } : entry
                    )
                  )
                }
              />
            ) : null}
            <Checkbox.Group
              value={header.applyTo}
              options={[
                { label: 'Request', value: 'request' },
                { label: 'Subscription handshake', value: 'subscription-handshake' },
                { label: 'Connection init payload', value: 'subscription-init' }
              ]}
              onChange={(value) =>
                onChange(
                  headers.map((entry, entryIndex) =>
                    entryIndex === index
                      ? {
                          ...entry,
                          applyTo: value as HeaderDraft['applyTo']
                        }
                      : entry
                  )
                )
              }
            />
          </Space>
        </OperationCard>
      ))}
      <Button icon={<Plus size={14} />} onClick={() => onChange([...headers, createHeaderDraft()])}>
        Add Header
      </Button>
    </Space>
  </Section>
)

const ToolbarRow = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
`

const CardsColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const CardHeader = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
`

const CardTitle = styled.div`
  font-weight: 600;
`

const CardMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--color-text-3);
  font-size: 12px;
  margin-top: 6px;
`

const FormCard = styled.div`
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 16px;
  background: var(--color-background);
`

const FieldGrid = styled.div`
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
`

const Section = styled.div`
  width: 100%;
`

const SectionLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
`

const OperationCard = styled.div`
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  background: var(--color-background);
`

const EmptyState = styled.div`
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  padding: 24px;
  color: var(--color-text-3);
  text-align: center;
`

export default ServicesSettings
