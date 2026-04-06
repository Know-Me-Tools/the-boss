import ListItem from '@renderer/components/ListItem'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useServices } from '@renderer/hooks/useServices'
import type {
  GraphQLServiceDefinition,
  GraphQLServiceOperation,
  GraphQLServiceOperationType,
  HeaderTemplateInput,
  ImportGraphQLServiceRequest,
  ImportOpenAPIServiceRequest,
  ImportSupabaseServiceRequest,
  OpenAPIServiceDefinition,
  ServiceAuthInput,
  ServiceDefinition,
  ServiceKind,
  ServiceToolProjection,
  SupabaseServiceDefinition
} from '@shared/services'
import { Button, Card, Checkbox, Input, Modal, Select, Space, Tag } from 'antd'
import { Braces, Database, Globe2, Plus, RefreshCw, Search, Server, TestTube2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import styled from 'styled-components'

import { SettingContainer, SettingDescription, SettingGroup, SettingTitle } from '..'

type ServiceFilter = 'all' | ServiceKind

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

type OpenApiDraft = {
  name: string
  sourceType: 'url' | 'file' | 'text'
  source: string
  endpoint: string
  auth: AuthDraft
  headers: HeaderDraft[]
}

type GraphqlDraft = {
  name: string
  endpoint: string
  subscriptionEndpoint: string
  sourceType: 'introspection' | 'sdl'
  source: string
  auth: AuthDraft
  headers: HeaderDraft[]
  operations: GraphQLOperationDraft[]
}

type SupabaseDraft = {
  name: string
  endpoint: string
  anonKeyLabel: string
  anonKeyValue: string
  serviceRoleKeyLabel: string
  serviceRoleKeyValue: string
  headers: HeaderDraft[]
}

const SERVICE_KIND_OPTIONS: Array<{ label: string; value: ServiceKind }> = [
  { label: 'Supabase', value: 'supabase' },
  { label: 'OpenAPI', value: 'openapi' },
  { label: 'GraphQL', value: 'graphql' }
]

const createEmptyOpenApiImport = (): OpenApiDraft => ({
  name: '',
  sourceType: 'url',
  source: '',
  endpoint: '',
  auth: { type: 'none' },
  headers: []
})

const createEmptyGraphqlImport = (): GraphqlDraft => ({
  name: '',
  endpoint: '',
  subscriptionEndpoint: '',
  sourceType: 'introspection',
  source: '',
  auth: { type: 'none' },
  headers: [],
  operations: []
})

const createEmptySupabaseImport = (): SupabaseDraft => ({
  name: '',
  endpoint: '',
  anonKeyLabel: '',
  anonKeyValue: '',
  serviceRoleKeyLabel: '',
  serviceRoleKeyValue: '',
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

function isServiceKind(value: string | null): value is ServiceKind {
  return value === 'openapi' || value === 'graphql' || value === 'supabase'
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

function getKindLabel(kind: ServiceKind): string {
  switch (kind) {
    case 'openapi':
      return 'OpenAPI'
    case 'graphql':
      return 'GraphQL'
    case 'supabase':
      return 'Supabase'
  }
}

function getKindIcon(kind: ServiceKind) {
  switch (kind) {
    case 'openapi':
      return <Globe2 size={16} />
    case 'graphql':
      return <Braces size={16} />
    case 'supabase':
      return <Database size={16} />
  }
}

function getAuthSummary(auth: ServiceDefinition['auth']): string {
  switch (auth.type) {
    case 'none':
      return 'No auth'
    case 'bearer':
      return 'Bearer / JWT'
    case 'api-key':
      return `API key in ${auth.headerName}`
    case 'basic':
      return 'Basic auth'
  }
}

function getProjectionByOperation(
  projectedTools: ServiceToolProjection[],
  sourceOperationId: string
): ServiceToolProjection | undefined {
  return projectedTools.find((tool) => tool.sourceOperationId === sourceOperationId)
}

const ServicesSettings = () => {
  const { theme } = useTheme()
  const { services, loading, importOpenAPI, importGraphQL, importSupabase, updateService, deleteService, reload } =
    useServices()
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchText, setSearchText] = useState('')
  const [kindFilter, setKindFilter] = useState<ServiceFilter>('all')
  const [showKindPicker, setShowKindPicker] = useState(false)
  const [openApiDraft, setOpenApiDraft] = useState(createEmptyOpenApiImport())
  const [graphqlDraft, setGraphqlDraft] = useState(createEmptyGraphqlImport())
  const [supabaseDraft, setSupabaseDraft] = useState(createEmptySupabaseImport())
  const [editingService, setEditingService] = useState<ServiceDefinition | null>(null)
  const [editingProjectedTools, setEditingProjectedTools] = useState<ServiceToolProjection[]>([])
  const [editingGraphqlOperations, setEditingGraphqlOperations] = useState<GraphQLOperationDraft[]>([])
  const [healthState, setHealthState] = useState<Record<string, string>>({})

  const selectedServiceId = searchParams.get('id')
  const mode = searchParams.get('mode')
  const createKindParam = searchParams.get('kind')
  const createKind = isServiceKind(createKindParam) ? createKindParam : null
  const isCreateMode = mode === 'new' && Boolean(createKind)

  const selectedService = useMemo(
    () => services.find((service) => service.serviceId === selectedServiceId) ?? null,
    [selectedServiceId, services]
  )

  useEffect(() => {
    if (loading || isCreateMode) {
      return
    }

    if (selectedService) {
      return
    }

    if (services.length === 0) {
      if (selectedServiceId) {
        setSearchParams({})
      }
      return
    }

    setSearchParams({ id: services[0].serviceId })
  }, [isCreateMode, loading, selectedService, selectedServiceId, services, setSearchParams])

  useEffect(() => {
    if (!selectedService) {
      setEditingService(null)
      setEditingProjectedTools([])
      setEditingGraphqlOperations([])
      return
    }

    setEditingService(selectedService)
    setEditingProjectedTools(mapProjectedTools(selectedService))
    setEditingGraphqlOperations(mapGraphqlOperations(selectedService))
  }, [selectedService])

  const filteredServices = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase()

    return services.filter((service) => {
      if (kindFilter !== 'all' && service.kind !== kindFilter) {
        return false
      }

      if (!normalizedSearch) {
        return true
      }

      return (
        service.name.toLowerCase().includes(normalizedSearch) ||
        service.endpoint.toLowerCase().includes(normalizedSearch) ||
        service.kind.toLowerCase().includes(normalizedSearch)
      )
    })
  }, [kindFilter, searchText, services])

  const enterCreateMode = useCallback(
    (kind: ServiceKind) => {
      setSearchParams({
        mode: 'new',
        kind
      })
      setShowKindPicker(false)
    },
    [setSearchParams]
  )

  const selectService = useCallback(
    (serviceId: string) => {
      setSearchParams({
        id: serviceId
      })
    },
    [setSearchParams]
  )

  const closeCreateMode = useCallback(() => {
    if (selectedServiceId) {
      setSearchParams({ id: selectedServiceId })
      return
    }

    if (services[0]) {
      setSearchParams({ id: services[0].serviceId })
      return
    }

    setSearchParams({})
  }, [selectedServiceId, services, setSearchParams])

  const runHealthCheck = useCallback(async (serviceId: string) => {
    const result = await window.api.services.testConnection(serviceId)
    setHealthState((prev) => ({
      ...prev,
      [serviceId]: result.ok ? `Healthy${result.status ? ` (${result.status})` : ''}` : result.message || 'Unreachable'
    }))
  }, [])

  const confirmDelete = useCallback(
    (service: ServiceDefinition) => {
      Modal.confirm({
        title: `Delete ${service.name}?`,
        content: 'This removes the shared service from the registry. Artifacts that reference it will lose access.',
        okButtonProps: { danger: true },
        okText: 'Delete',
        centered: true,
        onOk: async () => {
          const nextService = services.find((item) => item.serviceId !== service.serviceId)
          const deleted = await deleteService(service.serviceId)
          if (!deleted) {
            return
          }

          if (selectedServiceId === service.serviceId) {
            if (nextService) {
              setSearchParams({ id: nextService.serviceId })
            } else {
              setSearchParams({})
            }
          }
        }
      })
    },
    [deleteService, selectedServiceId, services, setSearchParams]
  )

  const saveExistingService = useCallback(async () => {
    if (!editingService) {
      return
    }

    await updateService(editingService.serviceId, {
      name: editingService.name,
      endpoint: editingService.endpoint,
      subscriptionEndpoint: editingService.kind === 'graphql' ? editingService.subscriptionEndpoint : undefined,
      projectedTools: editingService.kind !== 'graphql' ? editingProjectedTools : undefined,
      graphqlOperations: editingService.kind === 'graphql' ? toGraphqlOperations(editingGraphqlOperations) : undefined
    })
  }, [editingGraphqlOperations, editingProjectedTools, editingService, updateService])

  const createOpenApiService = useCallback(async () => {
    const request: ImportOpenAPIServiceRequest = {
      name: openApiDraft.name,
      sourceType: openApiDraft.sourceType,
      source: openApiDraft.source,
      endpoint: openApiDraft.endpoint || undefined,
      auth: toAuthInput(openApiDraft.auth),
      headerTemplates: toHeaderInputs(openApiDraft.headers)
    }
    const service = await importOpenAPI(request)
    setOpenApiDraft(createEmptyOpenApiImport())
    setSearchParams({ id: service.serviceId })
  }, [importOpenAPI, openApiDraft, setSearchParams])

  const createGraphqlService = useCallback(async () => {
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
    setSearchParams({ id: service.serviceId })
  }, [graphqlDraft, importGraphQL, setSearchParams, updateService])

  const createSupabaseService = useCallback(async () => {
    const request: ImportSupabaseServiceRequest = {
      name: supabaseDraft.name,
      endpoint: supabaseDraft.endpoint,
      anonKey: {
        label: supabaseDraft.anonKeyLabel || 'Supabase anon key',
        value: supabaseDraft.anonKeyValue
      },
      serviceRoleKey: supabaseDraft.serviceRoleKeyValue
        ? {
            label: supabaseDraft.serviceRoleKeyLabel || 'Supabase service-role key',
            value: supabaseDraft.serviceRoleKeyValue
          }
        : undefined,
      headerTemplates: toHeaderInputs(supabaseDraft.headers)
    }
    const service = await importSupabase(request)
    setSupabaseDraft(createEmptySupabaseImport())
    setSearchParams({ id: service.serviceId })
  }, [importSupabase, setSearchParams, supabaseDraft])

  return (
    <>
      <PageShell>
        <RegistryColumn>
          <RegistryHeader>
            <SettingTitle>Services</SettingTitle>
            <SettingDescription>Shared external interfaces for artifacts, assistants, and agents.</SettingDescription>
          </RegistryHeader>
          <RegistryToolbar>
            <Input
              value={searchText}
              placeholder="Search services"
              prefix={<Search size={14} />}
              onChange={(event) => setSearchText(event.target.value)}
              allowClear
            />
            <Select
              value={kindFilter}
              options={[
                { label: 'All', value: 'all' },
                ...SERVICE_KIND_OPTIONS.map((item) => ({ label: item.label, value: item.value }))
              ]}
              onChange={(value) => setKindFilter(value)}
            />
            <Button icon={<RefreshCw size={14} />} onClick={() => void reload()} loading={loading}>
              Refresh
            </Button>
          </RegistryToolbar>
          <RegistryList>
            {filteredServices.length > 0 ? (
              filteredServices.map((service) => (
                <ListItem
                  key={service.serviceId}
                  active={!isCreateMode && selectedServiceId === service.serviceId}
                  icon={getKindIcon(service.kind)}
                  title={service.name}
                  subtitle={service.endpoint}
                  onClick={() => selectService(service.serviceId)}
                  rightContent={<Tag>{getKindLabel(service.kind)}</Tag>}
                />
              ))
            ) : (
              <RegistryEmptyState>No services match the current filters.</RegistryEmptyState>
            )}
          </RegistryList>
          <RegistryFooter>
            <Button type="primary" icon={<Plus size={14} />} onClick={() => setShowKindPicker(true)}>
              Add Service
            </Button>
          </RegistryFooter>
        </RegistryColumn>

        <EditorColumn theme={theme}>
          {isCreateMode && createKind ? (
            <CreateEditorPane
              kind={createKind}
              openApiDraft={openApiDraft}
              graphqlDraft={graphqlDraft}
              supabaseDraft={supabaseDraft}
              setOpenApiDraft={setOpenApiDraft}
              setGraphqlDraft={setGraphqlDraft}
              setSupabaseDraft={setSupabaseDraft}
              onCancel={closeCreateMode}
              onCreateOpenApi={() => void createOpenApiService()}
              onCreateGraphql={() => void createGraphqlService()}
              onCreateSupabase={() => void createSupabaseService()}
            />
          ) : editingService ? (
            <ExistingEditorPane
              healthState={healthState}
              editingService={editingService}
              editingProjectedTools={editingProjectedTools}
              editingGraphqlOperations={editingGraphqlOperations}
              setEditingService={setEditingService}
              setEditingProjectedTools={setEditingProjectedTools}
              setEditingGraphqlOperations={setEditingGraphqlOperations}
              onRunHealthCheck={() => void runHealthCheck(editingService.serviceId)}
              onSave={() => void saveExistingService()}
              onDelete={() => confirmDelete(editingService)}
            />
          ) : (
            <EmptyEditorState theme={theme}>
              <Server size={22} />
              <SettingTitle>No Services Yet</SettingTitle>
              <SettingDescription>
                Add a shared service to make it available to artifacts, assistants, and agents.
              </SettingDescription>
              <Button type="primary" icon={<Plus size={14} />} onClick={() => setShowKindPicker(true)}>
                Add Your First Service
              </Button>
            </EmptyEditorState>
          )}
        </EditorColumn>
      </PageShell>

      <Modal
        open={showKindPicker}
        title="Choose service type"
        onCancel={() => setShowKindPicker(false)}
        footer={null}
        destroyOnClose>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {SERVICE_KIND_OPTIONS.map((option) => (
            <KindCardButton key={option.value} onClick={() => enterCreateMode(option.value)}>
              <KindCardContent>
                {getKindIcon(option.value)}
                <div>
                  <KindCardTitle>{option.label}</KindCardTitle>
                  <KindCardDescription>
                    {option.value === 'supabase'
                      ? 'Register a brokered Supabase project with shared anon and service-role secrets.'
                      : option.value === 'openapi'
                        ? 'Import a reusable OpenAPI 3.x service and curate which operations become tools.'
                        : 'Configure a shared GraphQL endpoint with saved operations and runtime subscriptions.'}
                  </KindCardDescription>
                </div>
              </KindCardContent>
            </KindCardButton>
          ))}
        </Space>
      </Modal>
    </>
  )
}

const CreateEditorPane = ({
  kind,
  openApiDraft,
  graphqlDraft,
  supabaseDraft,
  setOpenApiDraft,
  setGraphqlDraft,
  setSupabaseDraft,
  onCancel,
  onCreateOpenApi,
  onCreateGraphql,
  onCreateSupabase
}: {
  kind: ServiceKind
  openApiDraft: OpenApiDraft
  graphqlDraft: GraphqlDraft
  supabaseDraft: SupabaseDraft
  setOpenApiDraft: React.Dispatch<React.SetStateAction<OpenApiDraft>>
  setGraphqlDraft: React.Dispatch<React.SetStateAction<GraphqlDraft>>
  setSupabaseDraft: React.Dispatch<React.SetStateAction<SupabaseDraft>>
  onCancel: () => void
  onCreateOpenApi: () => void
  onCreateGraphql: () => void
  onCreateSupabase: () => void
}) => (
  <>
    <SettingGroup>
      <EditorTitleRow>
        <div>
          <SettingTitle>{`Create ${getKindLabel(kind)} Service`}</SettingTitle>
          <SettingDescription>
            New services are created directly in this editor and added to the shared registry.
          </SettingDescription>
        </div>
        <Space>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            type="primary"
            onClick={kind === 'openapi' ? onCreateOpenApi : kind === 'graphql' ? onCreateGraphql : onCreateSupabase}>
            Create Service
          </Button>
        </Space>
      </EditorTitleRow>
    </SettingGroup>

    {kind === 'openapi' ? (
      <OpenApiCreateForm draft={openApiDraft} onChange={setOpenApiDraft} />
    ) : kind === 'graphql' ? (
      <GraphqlCreateForm draft={graphqlDraft} onChange={setGraphqlDraft} />
    ) : (
      <SupabaseCreateForm draft={supabaseDraft} onChange={setSupabaseDraft} />
    )}
  </>
)

const ExistingEditorPane = ({
  healthState,
  editingService,
  editingProjectedTools,
  editingGraphqlOperations,
  setEditingService,
  setEditingProjectedTools,
  setEditingGraphqlOperations,
  onRunHealthCheck,
  onSave,
  onDelete
}: {
  healthState: Record<string, string>
  editingService: ServiceDefinition
  editingProjectedTools: ServiceToolProjection[]
  editingGraphqlOperations: GraphQLOperationDraft[]
  setEditingService: React.Dispatch<React.SetStateAction<ServiceDefinition | null>>
  setEditingProjectedTools: React.Dispatch<React.SetStateAction<ServiceToolProjection[]>>
  setEditingGraphqlOperations: React.Dispatch<React.SetStateAction<GraphQLOperationDraft[]>>
  onRunHealthCheck: () => void
  onSave: () => void
  onDelete: () => void
}) => (
  <>
    <SettingGroup>
      <EditorTitleRow>
        <div>
          <SettingTitle>{editingService.name}</SettingTitle>
          <SettingDescription>
            Shared {getKindLabel(editingService.kind)} service available to artifacts, assistants, and agents.
          </SettingDescription>
        </div>
        <Space>
          <Button icon={<TestTube2 size={14} />} onClick={onRunHealthCheck}>
            Test
          </Button>
          <Button type="primary" onClick={onSave}>
            Save Changes
          </Button>
          <Button danger icon={<Trash2 size={14} />} onClick={onDelete}>
            Delete
          </Button>
        </Space>
      </EditorTitleRow>
      <HealthBadgeRow>
        <Tag>{getKindLabel(editingService.kind)}</Tag>
        <Tag>{getAuthSummary(editingService.auth)}</Tag>
        <Tag>{`${editingService.headerTemplates.length} header templates`}</Tag>
        {healthState[editingService.serviceId] ? (
          <Tag color="processing">{healthState[editingService.serviceId]}</Tag>
        ) : null}
      </HealthBadgeRow>
    </SettingGroup>

    <SettingGroup>
      <SettingTitle>Shared Details</SettingTitle>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Input
          value={editingService.name}
          placeholder="Display name"
          onChange={(event) => setEditingService((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
        />
        <Input
          value={editingService.endpoint}
          placeholder="Endpoint / base URL"
          onChange={(event) => setEditingService((prev) => (prev ? { ...prev, endpoint: event.target.value } : prev))}
        />
        {editingService.kind === 'graphql' ? (
          <Input
            value={editingService.subscriptionEndpoint ?? ''}
            placeholder="Subscription endpoint"
            onChange={(event) =>
              setEditingService((prev) =>
                prev && prev.kind === 'graphql'
                  ? { ...prev, subscriptionEndpoint: event.target.value || undefined }
                  : prev
              )
            }
          />
        ) : null}
      </Space>
    </SettingGroup>

    <SettingGroup>
      <SettingTitle>Auth & Headers</SettingTitle>
      <SettingDescription>
        Auth preset: {getAuthSummary(editingService.auth)}. Header templates: {editingService.headerTemplates.length}.
        Secret-backed values remain stored in the main process and must be rotated by re-importing the service.
      </SettingDescription>
      <SummaryCard>
        <SummaryLabel>Import source</SummaryLabel>
        <SummaryValue>{editingService.importSource.type}</SummaryValue>
        {editingService.importSource.locator ? (
          <>
            <SummaryLabel>Source locator</SummaryLabel>
            <SummaryValue>{editingService.importSource.locator}</SummaryValue>
          </>
        ) : null}
      </SummaryCard>
    </SettingGroup>

    {editingService.kind === 'openapi' ? (
      <OpenApiExistingForm
        service={editingService}
        projectedTools={editingProjectedTools}
        setProjectedTools={setEditingProjectedTools}
      />
    ) : editingService.kind === 'graphql' ? (
      <GraphqlExistingForm
        service={editingService}
        operations={editingGraphqlOperations}
        setOperations={setEditingGraphqlOperations}
      />
    ) : (
      <SupabaseExistingForm
        service={editingService}
        projectedTools={editingProjectedTools}
        setProjectedTools={setEditingProjectedTools}
      />
    )}
  </>
)

const OpenApiCreateForm = ({
  draft,
  onChange
}: {
  draft: OpenApiDraft
  onChange: React.Dispatch<React.SetStateAction<OpenApiDraft>>
}) => (
  <>
    <SettingGroup>
      <SettingTitle>Import</SettingTitle>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Input
          placeholder="Display name"
          value={draft.name}
          onChange={(event) => onChange((prev) => ({ ...prev, name: event.target.value }))}
        />
        <Select
          value={draft.sourceType}
          options={[
            { label: 'Spec URL', value: 'url' },
            { label: 'Local file', value: 'file' },
            { label: 'Pasted JSON/YAML', value: 'text' }
          ]}
          onChange={(value) => onChange((prev) => ({ ...prev, sourceType: value }))}
        />
        <Input.TextArea
          rows={6}
          placeholder={draft.sourceType === 'text' ? 'Paste OpenAPI 3.0 JSON/YAML' : 'Enter spec URL or file path'}
          value={draft.source}
          onChange={(event) => onChange((prev) => ({ ...prev, source: event.target.value }))}
        />
        <Input
          placeholder="Endpoint override (optional)"
          value={draft.endpoint}
          onChange={(event) => onChange((prev) => ({ ...prev, endpoint: event.target.value }))}
        />
      </Space>
    </SettingGroup>
    <AuthEditor auth={draft.auth} onChange={(auth) => onChange((prev) => ({ ...prev, auth }))} />
    <HeaderEditor headers={draft.headers} onChange={(headers) => onChange((prev) => ({ ...prev, headers }))} />
  </>
)

const GraphqlCreateForm = ({
  draft,
  onChange
}: {
  draft: GraphqlDraft
  onChange: React.Dispatch<React.SetStateAction<GraphqlDraft>>
}) => (
  <>
    <SettingGroup>
      <SettingTitle>Schema Setup</SettingTitle>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Input
          placeholder="Display name"
          value={draft.name}
          onChange={(event) => onChange((prev) => ({ ...prev, name: event.target.value }))}
        />
        <Input
          placeholder="GraphQL endpoint"
          value={draft.endpoint}
          onChange={(event) => onChange((prev) => ({ ...prev, endpoint: event.target.value }))}
        />
        <Input
          placeholder="Subscription endpoint (optional)"
          value={draft.subscriptionEndpoint}
          onChange={(event) => onChange((prev) => ({ ...prev, subscriptionEndpoint: event.target.value }))}
        />
        <Select
          value={draft.sourceType}
          options={[
            { label: 'Schema introspection', value: 'introspection' },
            { label: 'Pasted SDL', value: 'sdl' }
          ]}
          onChange={(value) => onChange((prev) => ({ ...prev, sourceType: value }))}
        />
        {draft.sourceType === 'sdl' ? (
          <Input.TextArea
            rows={6}
            placeholder="Paste GraphQL SDL"
            value={draft.source}
            onChange={(event) => onChange((prev) => ({ ...prev, source: event.target.value }))}
          />
        ) : null}
      </Space>
    </SettingGroup>
    <AuthEditor auth={draft.auth} onChange={(auth) => onChange((prev) => ({ ...prev, auth }))} />
    <HeaderEditor headers={draft.headers} onChange={(headers) => onChange((prev) => ({ ...prev, headers }))} />
    <SettingGroup>
      <SettingTitle>Saved Operations</SettingTitle>
      <SettingDescription>
        Queries and mutations can project into tools. Subscriptions stay runtime-only.
      </SettingDescription>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {draft.operations.map((operation, index) => (
          <GraphqlOperationCard
            key={operation.id}
            operation={operation}
            onChange={(nextOperation) =>
              onChange((prev) => ({
                ...prev,
                operations: prev.operations.map((entry, entryIndex) => (entryIndex === index ? nextOperation : entry))
              }))
            }
          />
        ))}
        <Button
          icon={<Plus size={14} />}
          onClick={() => onChange((prev) => ({ ...prev, operations: [...prev.operations, createOperationDraft()] }))}>
          Add GraphQL Operation
        </Button>
      </Space>
    </SettingGroup>
  </>
)

const SupabaseCreateForm = ({
  draft,
  onChange
}: {
  draft: SupabaseDraft
  onChange: React.Dispatch<React.SetStateAction<SupabaseDraft>>
}) => (
  <>
    <SettingGroup>
      <SettingTitle>Project Setup</SettingTitle>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Input
          placeholder="Display name"
          value={draft.name}
          onChange={(event) => onChange((prev) => ({ ...prev, name: event.target.value }))}
        />
        <Input
          placeholder="Supabase project URL"
          value={draft.endpoint}
          onChange={(event) => onChange((prev) => ({ ...prev, endpoint: event.target.value }))}
        />
        <Input
          placeholder="ANON key label"
          value={draft.anonKeyLabel}
          onChange={(event) => onChange((prev) => ({ ...prev, anonKeyLabel: event.target.value }))}
        />
        <Input.Password
          placeholder="Supabase ANON key"
          value={draft.anonKeyValue}
          onChange={(event) => onChange((prev) => ({ ...prev, anonKeyValue: event.target.value }))}
        />
        <Input
          placeholder="Service-role key label (optional)"
          value={draft.serviceRoleKeyLabel}
          onChange={(event) => onChange((prev) => ({ ...prev, serviceRoleKeyLabel: event.target.value }))}
        />
        <Input.Password
          placeholder="Supabase service-role key (optional)"
          value={draft.serviceRoleKeyValue}
          onChange={(event) => onChange((prev) => ({ ...prev, serviceRoleKeyValue: event.target.value }))}
        />
      </Space>
    </SettingGroup>
    <HeaderEditor headers={draft.headers} onChange={(headers) => onChange((prev) => ({ ...prev, headers }))} />
    <SettingGroup>
      <SettingTitle>Brokered REST</SettingTitle>
      <SettingDescription>
        This creates a shared `rest` operation for PostgREST resources and RPC endpoints under `/rest/v1`.
      </SettingDescription>
    </SettingGroup>
  </>
)

const OpenApiExistingForm = ({
  service,
  projectedTools,
  setProjectedTools
}: {
  service: OpenAPIServiceDefinition
  projectedTools: ServiceToolProjection[]
  setProjectedTools: React.Dispatch<React.SetStateAction<ServiceToolProjection[]>>
}) => (
  <>
    <SettingGroup>
      <SettingTitle>Import Snapshot</SettingTitle>
      <SummaryCard>
        <SummaryLabel>Server URLs</SummaryLabel>
        <SummaryValue>{service.serverUrls.length > 0 ? service.serverUrls.join(', ') : 'None in spec'}</SummaryValue>
        <SummaryLabel>Imported at</SummaryLabel>
        <SummaryValue>{service.refresh.lastImportedAt ?? 'Unknown'}</SummaryValue>
        <SummaryLabel>Operations</SummaryLabel>
        <SummaryValue>{String(service.operations.length)}</SummaryValue>
      </SummaryCard>
    </SettingGroup>
    <SettingGroup>
      <SettingTitle>Tool Projection</SettingTitle>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {service.operations.map((operation) => {
          const projection = getProjectionByOperation(projectedTools, operation.id)

          return (
            <OperationCard key={operation.id}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <OperationMeta>
                  <Tag>{operation.method.toUpperCase()}</Tag>
                  <span>{operation.path}</span>
                </OperationMeta>
                <Input
                  value={projection?.name ?? ''}
                  placeholder="Tool name"
                  onChange={(event) =>
                    setProjectedTools((prev) =>
                      prev.map((entry) =>
                        entry.sourceOperationId === operation.id ? { ...entry, name: event.target.value } : entry
                      )
                    )
                  }
                />
                <Input.TextArea
                  rows={2}
                  value={projection?.description ?? operation.summary ?? operation.description ?? ''}
                  placeholder="Tool description"
                  onChange={(event) =>
                    setProjectedTools((prev) =>
                      prev.map((entry) =>
                        entry.sourceOperationId === operation.id ? { ...entry, description: event.target.value } : entry
                      )
                    )
                  }
                />
                <Checkbox
                  checked={projection?.enabled ?? false}
                  onChange={(event) =>
                    setProjectedTools((prev) =>
                      prev.map((entry) =>
                        entry.sourceOperationId === operation.id ? { ...entry, enabled: event.target.checked } : entry
                      )
                    )
                  }>
                  Expose this operation as a tool
                </Checkbox>
              </Space>
            </OperationCard>
          )
        })}
      </Space>
    </SettingGroup>
  </>
)

const GraphqlExistingForm = ({
  service,
  operations,
  setOperations
}: {
  service: GraphQLServiceDefinition
  operations: GraphQLOperationDraft[]
  setOperations: React.Dispatch<React.SetStateAction<GraphQLOperationDraft[]>>
}) => (
  <>
    <SettingGroup>
      <SettingTitle>Schema Snapshot</SettingTitle>
      <SummaryCard>
        <SummaryLabel>Schema source</SummaryLabel>
        <SummaryValue>{service.importSource.type}</SummaryValue>
        <SummaryLabel>Imported at</SummaryLabel>
        <SummaryValue>{service.refresh.lastImportedAt ?? 'Unknown'}</SummaryValue>
        <SummaryLabel>Subscriptions</SummaryLabel>
        <SummaryValue>
          {String(service.operations.filter((operation) => operation.operationType === 'subscription').length)}
        </SummaryValue>
      </SummaryCard>
    </SettingGroup>
    <SettingGroup>
      <SettingTitle>Saved Operations</SettingTitle>
      <SettingDescription>
        Subscriptions remain available to artifact runtime flows but are not projected as tools.
      </SettingDescription>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {operations.map((operation, index) => (
          <GraphqlOperationCard
            key={operation.id}
            operation={operation}
            onChange={(nextOperation) =>
              setOperations((prev) => prev.map((entry, entryIndex) => (entryIndex === index ? nextOperation : entry)))
            }
          />
        ))}
        <Button icon={<Plus size={14} />} onClick={() => setOperations((prev) => [...prev, createOperationDraft()])}>
          Add Operation
        </Button>
      </Space>
    </SettingGroup>
  </>
)

const SupabaseExistingForm = ({
  service,
  projectedTools,
  setProjectedTools
}: {
  service: SupabaseServiceDefinition
  projectedTools: ServiceToolProjection[]
  setProjectedTools: React.Dispatch<React.SetStateAction<ServiceToolProjection[]>>
}) => {
  const restProjection = getProjectionByOperation(projectedTools, 'rest')

  return (
    <>
      <SettingGroup>
        <SettingTitle>Brokered REST</SettingTitle>
        <SummaryCard>
          <SummaryLabel>Anon key</SummaryLabel>
          <SummaryValue>{service.anonKey.label || service.anonKey.id}</SummaryValue>
          <SummaryLabel>Service-role key</SummaryLabel>
          <SummaryValue>{service.serviceRoleKey?.label || service.serviceRoleKey?.id || 'Not configured'}</SummaryValue>
          <SummaryLabel>Operation path</SummaryLabel>
          <SummaryValue>{service.operations[0]?.pathPrefix ?? '/rest/v1'}</SummaryValue>
        </SummaryCard>
      </SettingGroup>
      <SettingGroup>
        <SettingTitle>Tool Projection</SettingTitle>
        <OperationCard>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Input
              value={restProjection?.name ?? ''}
              placeholder="Tool name"
              onChange={(event) =>
                setProjectedTools((prev) =>
                  prev.map((entry) =>
                    entry.sourceOperationId === 'rest' ? { ...entry, name: event.target.value } : entry
                  )
                )
              }
            />
            <Input.TextArea
              rows={2}
              value={restProjection?.description ?? ''}
              placeholder="Tool description"
              onChange={(event) =>
                setProjectedTools((prev) =>
                  prev.map((entry) =>
                    entry.sourceOperationId === 'rest' ? { ...entry, description: event.target.value } : entry
                  )
                )
              }
            />
            <Checkbox
              checked={restProjection?.enabled ?? false}
              onChange={(event) =>
                setProjectedTools((prev) =>
                  prev.map((entry) =>
                    entry.sourceOperationId === 'rest' ? { ...entry, enabled: event.target.checked } : entry
                  )
                )
              }>
              Expose brokered Supabase REST as a tool
            </Checkbox>
          </Space>
        </OperationCard>
      </SettingGroup>
    </>
  )
}

const GraphqlOperationCard = ({
  operation,
  onChange
}: {
  operation: GraphQLOperationDraft
  onChange: (operation: GraphQLOperationDraft) => void
}) => (
  <OperationCard>
    <Space direction="vertical" style={{ width: '100%' }}>
      <Input
        placeholder="Operation name"
        value={operation.name}
        onChange={(event) => onChange({ ...operation, name: event.target.value })}
      />
      <Select
        value={operation.operationType}
        options={[
          { label: 'Query', value: 'query' },
          { label: 'Mutation', value: 'mutation' },
          { label: 'Subscription', value: 'subscription' }
        ]}
        onChange={(value) => onChange({ ...operation, operationType: value })}
      />
      <Input
        placeholder="Projection name (optional)"
        value={operation.projectionName}
        onChange={(event) => onChange({ ...operation, projectionName: event.target.value })}
      />
      <Input.TextArea
        rows={5}
        placeholder="Operation text"
        value={operation.text}
        onChange={(event) => onChange({ ...operation, text: event.target.value })}
      />
      <Checkbox
        checked={operation.projected}
        disabled={operation.operationType === 'subscription'}
        onChange={(event) => onChange({ ...operation, projected: event.target.checked })}>
        {operation.operationType === 'subscription'
          ? 'Subscriptions stay runtime-only'
          : 'Project this operation as a tool'}
      </Checkbox>
    </Space>
  </OperationCard>
)

const AuthEditor = ({ auth, onChange }: { auth: AuthDraft; onChange: (auth: AuthDraft) => void }) => (
  <SettingGroup>
    <SettingTitle>Auth</SettingTitle>
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
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
          if (value === 'bearer') {
            onChange({
              type: 'bearer',
              headerName: 'Authorization',
              scheme: 'Bearer',
              tokenLabel: '',
              tokenValue: ''
            })
          }
          if (value === 'api-key') {
            onChange({
              type: 'api-key',
              headerName: 'x-api-key',
              prefix: '',
              tokenLabel: '',
              tokenValue: ''
            })
          }
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
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            value={auth.headerName}
            placeholder="Header name"
            onChange={(event) => onChange({ ...auth, headerName: event.target.value })}
          />
          <Input
            value={auth.scheme}
            placeholder="Scheme"
            onChange={(event) => onChange({ ...auth, scheme: event.target.value })}
          />
          <Input
            value={auth.tokenLabel}
            placeholder="Secret label"
            onChange={(event) => onChange({ ...auth, tokenLabel: event.target.value })}
          />
          <Input.Password
            value={auth.tokenValue}
            placeholder="Secret value"
            onChange={(event) => onChange({ ...auth, tokenValue: event.target.value })}
          />
        </Space>
      ) : null}
      {auth.type === 'api-key' ? (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            value={auth.headerName}
            placeholder="Header name"
            onChange={(event) => onChange({ ...auth, headerName: event.target.value })}
          />
          <Input
            value={auth.prefix}
            placeholder="Prefix (optional)"
            onChange={(event) => onChange({ ...auth, prefix: event.target.value })}
          />
          <Input
            value={auth.tokenLabel}
            placeholder="Secret label"
            onChange={(event) => onChange({ ...auth, tokenLabel: event.target.value })}
          />
          <Input.Password
            value={auth.tokenValue}
            placeholder="Secret value"
            onChange={(event) => onChange({ ...auth, tokenValue: event.target.value })}
          />
        </Space>
      ) : null}
      {auth.type === 'basic' ? (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            value={auth.headerName}
            placeholder="Header name"
            onChange={(event) => onChange({ ...auth, headerName: event.target.value })}
          />
          <Input
            value={auth.usernameLabel}
            placeholder="Username label"
            onChange={(event) => onChange({ ...auth, usernameLabel: event.target.value })}
          />
          <Input.Password
            value={auth.usernameValue}
            placeholder="Username value"
            onChange={(event) => onChange({ ...auth, usernameValue: event.target.value })}
          />
          <Input
            value={auth.passwordLabel}
            placeholder="Password label"
            onChange={(event) => onChange({ ...auth, passwordLabel: event.target.value })}
          />
          <Input.Password
            value={auth.passwordValue}
            placeholder="Password value"
            onChange={(event) => onChange({ ...auth, passwordValue: event.target.value })}
          />
        </Space>
      ) : null}
    </Space>
  </SettingGroup>
)

const HeaderEditor = ({
  headers,
  onChange
}: {
  headers: HeaderDraft[]
  onChange: (headers: HeaderDraft[]) => void
}) => (
  <SettingGroup>
    <SettingTitle>Header Templates</SettingTitle>
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      {headers.map((header, index) => (
        <OperationCard key={header.id}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Input
              placeholder="Header name"
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
            {header.mode === 'secret' ? (
              <Input
                placeholder="Secret label"
                value={header.label}
                onChange={(event) =>
                  onChange(
                    headers.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, label: event.target.value } : entry
                    )
                  )
                }
              />
            ) : null}
            <Input.Password
              placeholder={header.mode === 'secret' ? 'Secret value' : 'Header value'}
              value={header.value}
              onChange={(event) =>
                onChange(
                  headers.map((entry, entryIndex) =>
                    entryIndex === index ? { ...entry, value: event.target.value } : entry
                  )
                )
              }
            />
            <Select
              mode="multiple"
              value={header.applyTo}
              options={[
                { label: 'Request', value: 'request' },
                { label: 'Subscription handshake', value: 'subscription-handshake' },
                { label: 'Subscription init', value: 'subscription-init' }
              ]}
              onChange={(value) =>
                onChange(
                  headers.map((entry, entryIndex) => (entryIndex === index ? { ...entry, applyTo: value } : entry))
                )
              }
            />
            <Button
              danger
              type="text"
              icon={<Trash2 size={14} />}
              onClick={() => onChange(headers.filter((_, entryIndex) => entryIndex !== index))}>
              Remove Header
            </Button>
          </Space>
        </OperationCard>
      ))}
      <Button icon={<Plus size={14} />} onClick={() => onChange([...headers, createHeaderDraft()])}>
        Add Header Template
      </Button>
    </Space>
  </SettingGroup>
)

const PageShell = styled.div`
  display: flex;
  width: 100%;
  min-height: calc(100vh - var(--navbar-height) - 6px);
  overflow: hidden;
`

const RegistryColumn = styled.div`
  display: flex;
  flex-direction: column;
  width: var(--settings-width);
  min-width: var(--settings-width);
  border-right: 0.5px solid var(--color-border);
  background: var(--color-background);
`

const RegistryHeader = styled.div`
  padding: 20px 16px 12px;
`

const RegistryToolbar = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 12px 12px;
`

const RegistryList = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  padding: 0 12px 12px;
  overflow-y: auto;
`

const RegistryFooter = styled.div`
  padding: 12px;
  border-top: 0.5px solid var(--color-border);

  .ant-btn {
    width: 100%;
  }
`

const RegistryEmptyState = styled.div`
  padding: 16px;
  border: 1px dashed var(--color-border);
  border-radius: var(--list-item-border-radius);
  color: var(--color-text-3);
  font-size: 13px;
`

const EditorColumn = styled(SettingContainer)`
  flex: 1;
  overflow-y: auto;
  background: var(--color-background);
`

const EditorTitleRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
`

const HealthBadgeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
`

const SummaryCard = styled(Card)`
  border: 1px solid var(--color-border);

  .ant-card-body {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 10px 14px;
    padding: 14px 16px;
  }
`

const SummaryLabel = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
  font-weight: 500;
`

const SummaryValue = styled.div`
  color: var(--color-text);
  font-size: 13px;
  word-break: break-word;
`

const OperationCard = styled(Card)`
  border: 1px solid var(--color-border);

  .ant-card-body {
    padding: 14px 16px;
  }
`

const OperationMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-2);
  font-size: 12px;
`

const EmptyEditorState = styled(SettingContainer)`
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 12px;
`

const KindCardButton = styled.button`
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--list-item-border-radius);
  background: var(--color-background);
  padding: 14px 16px;
  cursor: pointer;
  text-align: left;

  &:hover {
    background: var(--color-background-soft);
  }
`

const KindCardContent = styled.div`
  display: flex;
  gap: 12px;
  align-items: flex-start;
`

const KindCardTitle = styled.div`
  font-weight: 600;
  margin-bottom: 4px;
`

const KindCardDescription = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
  line-height: 1.5;
`

export default ServicesSettings
