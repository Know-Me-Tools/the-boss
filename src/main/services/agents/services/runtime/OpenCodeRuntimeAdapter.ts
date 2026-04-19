import { validateModelId } from '@main/apiServer/utils'
import type * as OpenCodeSdk from '@opencode-ai/sdk'
import type { GetAgentSessionResponse } from '@types'
import type { TextStreamPart } from 'ai'
import { app } from 'electron'

import type { AgentServiceInterface, AgentStream } from '../../interfaces/AgentStreamInterface'
import { emitTextBlock, RuntimeAgentStream } from './RuntimeAgentStream'
import { type AgentTurnInput, getPromptText, resolveAgentTurnInput } from './RuntimeContextBundle'
import { type AgentRuntimeCapabilities, DEFAULT_RUNTIME_CAPABILITIES, resolveRuntimeConfig } from './types'

type OpenCodeClient = any
type OpenCodeServer = { url: string; close(): void }
type OpenCodeModule = typeof OpenCodeSdk
type OpenCodePermissionMode = 'ask' | 'allow' | 'deny'
type ManagedOpenCodeServer = {
  client: OpenCodeClient
  server: OpenCodeServer
}
type OpenCodePermissionClientRef = {
  client: OpenCodeClient
  sessionId: string
}

const managedOpenCodeServers = new Map<string, Promise<ManagedOpenCodeServer>>()
const openCodePermissionClients = new Map<string, OpenCodePermissionClientRef>()
let shutdownHookRegistered = false

export class OpenCodeRuntimeAdapter implements AgentServiceInterface {
  readonly capabilities: AgentRuntimeCapabilities = {
    ...DEFAULT_RUNTIME_CAPABILITIES,
    tools: true,
    mcp: true,
    fileAccess: true,
    shellAccess: true,
    approvals: true,
    resume: true
  }

  async invoke(
    prompt: AgentTurnInput,
    session: GetAgentSessionResponse,
    abortController: AbortController,
    lastAgentSessionId?: string
  ): Promise<AgentStream> {
    const promptBundle = resolveAgentTurnInput(prompt)
    const promptText = getPromptText(prompt)
    const cwd = session.accessible_paths[0]
    if (!cwd) {
      return deferRuntimeError(new Error('No accessible paths defined for the OpenCode runtime session'))
    }

    const selectedModel = session.configuration?.runtime?.modelId ?? session.model
    const modelInfo = await validateModelId(selectedModel)
    if (!modelInfo.valid || !modelInfo.provider) {
      return deferRuntimeError(
        new Error(`Invalid OpenCode model ID '${selectedModel}': ${JSON.stringify(modelInfo.error)}`)
      )
    }
    const provider = modelInfo.provider
    const modelId = modelInfo.modelId
    if (!modelId) {
      return deferRuntimeError(new Error(`Invalid OpenCode model ID '${selectedModel}': missing provider model ID`))
    }

    const runtimeConfig = resolveRuntimeConfig(session)
    let opencodeConfig: Record<string, unknown>
    let agentName: string
    let tools: Record<string, boolean> | undefined
    try {
      agentName = resolveOpenCodeAgentName(runtimeConfig)
      tools = resolveOpenCodeTools(session.allowed_tools, runtimeConfig)
      opencodeConfig = buildOpenCodeConfig({
        session,
        runtimeConfig,
        provider,
        modelId,
        agentName,
        tools
      })
    } catch (error) {
      return deferRuntimeError(error instanceof Error ? error : new Error(String(error)))
    }

    const stream = new RuntimeAgentStream()

    void (async () => {
      try {
        const opencode = await import('@opencode-ai/sdk')
        const client = await resolveOpenCodeClient(opencode, runtimeConfig, cwd, opencodeConfig)
        if (runtimeConfig.mode === 'remote') {
          await updateRemoteOpenCodeConfig(client, cwd, opencodeConfig, abortController.signal)
        }

        const sessionId = lastAgentSessionId || (await createOpenCodeSession(client, cwd, session.name))
        stream.sdkSessionId = sessionId
        emitRuntimeStatus(stream, {
          runtime: 'opencode',
          phase: lastAgentSessionId ? 'session.resumed' : 'session.created',
          runtimeSessionId: sessionId,
          config: {
            model: `${provider.id}/${modelId}`,
            agent: agentName,
            permission: opencodeConfig.permission
          },
          context: {
            skillCount: promptBundle?.context.skills.length ?? 0,
            knowledgeReferenceCount: promptBundle?.context.knowledgeReferences.length ?? 0
          }
        })

        const eventForwarding = startOpenCodeEventForwarding(client, sessionId, stream, abortController.signal)

        const response = await client.session.prompt({
          path: { id: sessionId },
          query: { directory: cwd },
          body: {
            model: {
              providerID: provider.id,
              modelID: modelId
            },
            agent: agentName,
            system: session.instructions?.trim() || undefined,
            tools,
            parts: [
              {
                type: 'text',
                text: promptText
              }
            ]
          },
          signal: abortController.signal
        })

        await eventForwarding.settleBriefly()
        eventForwarding.stop()
        const text = collectOpenCodeText(response?.data?.parts)
        if (text) {
          emitTextBlock(stream, text)
        }
        emitOpenCodeParts(stream, response?.data?.parts)
        emitRuntimeStatus(stream, {
          runtime: 'opencode',
          phase: 'turn.completed',
          message: response?.data?.info
        })
        stream.emitComplete()
      } catch (error) {
        if (abortController.signal.aborted) {
          stream.emit('data', { type: 'cancelled' })
          return
        }
        stream.emitError(error instanceof Error ? error : new Error(String(error)))
      }
    })()

    return stream
  }
}

export async function disposeOpenCodeManagedServers(): Promise<void> {
  const entries = await Promise.allSettled(managedOpenCodeServers.values())
  managedOpenCodeServers.clear()
  openCodePermissionClients.clear()
  for (const entry of entries) {
    if (entry.status === 'fulfilled') {
      entry.value.server.close()
    }
  }
}

export async function respondToOpenCodePermission(request: {
  sessionId: string
  permissionId: string
  response: string
}): Promise<void> {
  const ref =
    openCodePermissionClients.get(`${request.sessionId}:${request.permissionId}`) ??
    openCodePermissionClients.get(request.permissionId)
  if (!ref) {
    throw new Error(`No active OpenCode permission request found for ${request.permissionId}`)
  }

  const response = request.response === 'deny' || request.response === 'reject' ? 'reject' : 'once'
  if (typeof ref.client.postSessionIdPermissionsPermissionId === 'function') {
    await ref.client.postSessionIdPermissionsPermissionId({
      path: {
        id: request.sessionId,
        permissionID: request.permissionId
      },
      body: {
        response
      }
    })
    openCodePermissionClients.delete(`${request.sessionId}:${request.permissionId}`)
    openCodePermissionClients.delete(request.permissionId)
    return
  }

  if (typeof ref.client.permission?.reply === 'function') {
    await ref.client.permission.reply({
      path: {
        requestID: request.permissionId
      },
      body: {
        reply: response
      }
    })
    openCodePermissionClients.delete(`${request.sessionId}:${request.permissionId}`)
    openCodePermissionClients.delete(request.permissionId)
    return
  }

  throw new Error('OpenCode client does not expose a permission response API')
}

function deferRuntimeError(error: Error): AgentStream {
  const stream = new RuntimeAgentStream()
  setTimeout(() => {
    stream.emitError(error)
  }, 0)
  return stream
}

async function resolveOpenCodeClient(
  opencode: OpenCodeModule,
  runtimeConfig: ReturnType<typeof resolveRuntimeConfig>,
  cwd: string,
  config: Record<string, unknown>
): Promise<OpenCodeClient> {
  if (runtimeConfig.mode === 'remote') {
    if (!runtimeConfig.endpoint) {
      throw new Error('OpenCode remote runtime requires a configured endpoint')
    }
    return opencode.createOpencodeClient(
      removeUndefinedValues({
        baseUrl: runtimeConfig.endpoint,
        directory: cwd,
        headers: resolveOpenCodeAuthHeaders(runtimeConfig.authRef)
      })
    )
  }

  registerOpenCodeShutdownHook()
  const key = `${cwd}:${JSON.stringify(config)}`
  if (!managedOpenCodeServers.has(key)) {
    managedOpenCodeServers.set(
      key,
      opencode.createOpencode({
        directory: cwd,
        config
      } as any)
    )
  }
  return (await managedOpenCodeServers.get(key)!).client
}

function registerOpenCodeShutdownHook(): void {
  if (shutdownHookRegistered) {
    return
  }
  shutdownHookRegistered = true
  app.once('before-quit', () => {
    void disposeOpenCodeManagedServers()
  })
}

function resolveOpenCodeAuthHeaders(authRef?: string): Record<string, string> | undefined {
  return authRef ? { authorization: `Bearer ${authRef}` } : undefined
}

async function updateRemoteOpenCodeConfig(
  client: OpenCodeClient,
  cwd: string,
  config: Record<string, unknown>,
  signal: AbortSignal
): Promise<void> {
  if (typeof client.config?.update !== 'function') {
    return
  }
  await client.config.update({
    query: { directory: cwd },
    body: config,
    signal
  })
}

function buildOpenCodeConfig(params: {
  session: GetAgentSessionResponse
  runtimeConfig: ReturnType<typeof resolveRuntimeConfig>
  provider: any
  modelId: string
  agentName: string
  tools?: Record<string, boolean>
}): Record<string, unknown> {
  const model = `${params.provider.id}/${params.modelId}`
  const permission = resolveOpenCodePermissionConfig(params.runtimeConfig.permissions?.mode)
  return removeUndefinedValues({
    model,
    provider: {
      [params.provider.id]: {
        options: removeUndefinedValues({
          apiKey: params.provider.apiKey,
          baseURL: params.provider.apiHost
        })
      }
    },
    mcp: resolveOpenCodeMcp(params.runtimeConfig.mcp),
    agent: {
      [params.agentName]: removeUndefinedValues({
        model,
        prompt: params.session.instructions?.trim() || undefined,
        tools: params.tools,
        permission
      })
    },
    permission,
    tools: params.tools
  })
}

function resolveOpenCodeAgentName(runtimeConfig: ReturnType<typeof resolveRuntimeConfig>): string {
  const value = (runtimeConfig as any).agentName
  return typeof value === 'string' && value.trim() ? value.trim() : 'general'
}

function resolveOpenCodeTools(
  allowedTools: string[] | undefined,
  runtimeConfig: ReturnType<typeof resolveRuntimeConfig>
): Record<string, boolean> | undefined {
  const tools: Record<string, boolean> = {}
  for (const tool of allowedTools ?? []) {
    if (tool) {
      tools[tool] = true
    }
  }

  const runtimeTools = asRecord((runtimeConfig as any).tools)
  for (const [tool, enabled] of Object.entries(runtimeTools ?? {})) {
    if (typeof enabled === 'boolean') {
      tools[tool] = enabled
    }
  }

  return Object.keys(tools).length > 0 ? tools : undefined
}

function resolveOpenCodePermissionConfig(value: unknown): Record<string, unknown> {
  const mode = resolveOpenCodePermissionMode(value)
  return {
    edit: mode,
    bash: mode,
    webfetch: mode,
    doom_loop: mode,
    external_directory: mode
  }
}

function resolveOpenCodePermissionMode(value: unknown): OpenCodePermissionMode {
  if (value === undefined || value === null || value === '' || value === 'ask' || value === 'default') {
    return 'ask'
  }
  if (value === 'allow' || value === 'bypassPermissions') {
    return 'allow'
  }
  if (value === 'deny') {
    return 'deny'
  }
  if (value === 'acceptEdits' || value === 'plan' || value === 'on-request') {
    return 'ask'
  }
  throw new Error(`Unsupported OpenCode permission mode '${String(value)}'`)
}

function resolveOpenCodeMcp(value: unknown): Record<string, unknown> | undefined {
  const mcpConfig = asRecord(value)
  if (!mcpConfig) {
    return undefined
  }
  const servers = asRecord(mcpConfig.servers) ?? asRecord(mcpConfig.mcp)
  return servers ? toPlainObject(servers) : undefined
}

async function createOpenCodeSession(client: unknown, cwd: string, title?: string): Promise<string> {
  const response = await (client as any).session.create({
    query: { directory: cwd },
    body: { title }
  })
  const id = response?.data?.id
  if (typeof id !== 'string' || !id) {
    throw new Error('OpenCode runtime did not return a session ID')
  }
  return id
}

function collectOpenCodeText(parts: unknown): string {
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
    .map((part: any) => part.text)
    .join('\n')
    .trim()
}

function startOpenCodeEventForwarding(
  client: OpenCodeClient,
  sessionId: string,
  stream: RuntimeAgentStream,
  abortSignal: AbortSignal
): { settleBriefly(): Promise<void>; stop(): void } {
  const eventAbortController = new AbortController()
  const stop = (): void => eventAbortController.abort()
  abortSignal.addEventListener('abort', stop, { once: true })

  const done = (async () => {
    if (typeof client.event?.subscribe !== 'function') {
      return
    }
    const subscription = await client.event.subscribe({ signal: eventAbortController.signal })
    for await (const event of subscription.stream ?? []) {
      if (eventAbortController.signal.aborted) {
        return
      }
      if (getOpenCodeEventSessionId(event) && getOpenCodeEventSessionId(event) !== sessionId) {
        continue
      }
      emitOpenCodeEvent(stream, event, client)
    }
  })().catch((error) => {
    if (!eventAbortController.signal.aborted) {
      emitRuntimeStatus(stream, {
        runtime: 'opencode',
        phase: 'event-stream.error',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })

  return {
    settleBriefly: () => Promise.race([done, delay(0)]).then(() => undefined),
    stop
  }
}

function emitOpenCodeEvent(stream: RuntimeAgentStream, event: any, client: OpenCodeClient): void {
  if (event?.type === 'permission.updated' || event?.type === 'permission.replied') {
    const permissionId = event.properties?.id ?? event.properties?.permissionID
    const sessionId = event.properties?.sessionID
    if (event.type === 'permission.updated' && permissionId && sessionId) {
      const ref = { client, sessionId }
      openCodePermissionClients.set(permissionId, ref)
      openCodePermissionClients.set(`${sessionId}:${permissionId}`, ref)
    }
    if (event.type === 'permission.replied' && permissionId && sessionId) {
      openCodePermissionClients.delete(permissionId)
      openCodePermissionClients.delete(`${sessionId}:${permissionId}`)
    }
    stream.emitChunk({
      type: 'data-agent-runtime-permission',
      data: {
        runtime: 'opencode',
        eventType: event.type,
        permission: event.properties,
        approval: {
          kind: 'opencode-permission',
          permissionId,
          responses: ['allow', 'deny']
        }
      }
    } as unknown as TextStreamPart<Record<string, any>>)
    return
  }

  if (event?.type === 'session.status' || event?.type === 'session.idle') {
    emitRuntimeStatus(stream, {
      runtime: 'opencode',
      phase: event.type,
      status: event.properties
    })
    return
  }

  if (event?.type === 'message.part.updated') {
    emitOpenCodeParts(stream, [event.properties?.part])
  }
}

function emitOpenCodeParts(stream: RuntimeAgentStream, parts: unknown): void {
  if (!Array.isArray(parts)) {
    return
  }

  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    const item = part as Record<string, any>
    if (item.type === 'text') {
      continue
    }
    if (item.type === 'tool') {
      stream.emitChunk({
        type: 'data-agent-runtime-tool',
        data: {
          runtime: 'opencode',
          itemType: item.type,
          itemId: item.id,
          tool: item.tool,
          status: item.state?.status,
          item
        }
      } as unknown as TextStreamPart<Record<string, any>>)
      continue
    }
    if (item.type === 'step-finish') {
      stream.emitChunk({
        type: 'data-agent-runtime-usage',
        data: {
          runtime: 'opencode',
          usage: {
            cost: item.cost,
            tokens: item.tokens,
            reason: item.reason
          }
        }
      } as unknown as TextStreamPart<Record<string, any>>)
      continue
    }
    stream.emitChunk({
      type: item.type === 'patch' || item.type === 'file' ? 'data-agent-runtime-file' : 'data-agent-runtime-item',
      data: {
        runtime: 'opencode',
        itemType: item.type,
        itemId: item.id,
        item
      }
    } as unknown as TextStreamPart<Record<string, any>>)
  }
}

function emitRuntimeStatus(stream: RuntimeAgentStream, data: Record<string, unknown>): void {
  stream.emitChunk({
    type: 'data-agent-runtime-status',
    data
  } as unknown as TextStreamPart<Record<string, any>>)
}

function getOpenCodeEventSessionId(event: any): string | undefined {
  const properties = event?.properties
  return properties?.sessionID ?? properties?.part?.sessionID
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function toPlainObject(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue
    if (Array.isArray(item)) {
      result[key] = item.map((entry) => (asRecord(entry) ? toPlainObject(asRecord(entry)!) : entry))
      continue
    }
    const record = asRecord(item)
    result[key] = record ? toPlainObject(record) : item
  }
  return result
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && (!Array.isArray(item) || item.length > 0))
  ) as T
}
