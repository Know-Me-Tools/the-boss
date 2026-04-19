import { validateModelId } from '@main/apiServer/utils'
import type { GetAgentSessionResponse } from '@types'
import type { TextStreamPart } from 'ai'

import type { AgentServiceInterface, AgentStream, AgentThinkingOptions } from '../../interfaces/AgentStreamInterface'
import { RuntimeAgentStream } from './RuntimeAgentStream'
import { type AgentTurnInput, getPromptText, resolveAgentTurnInput } from './RuntimeContextBundle'
import { type AgentRuntimeCapabilities, DEFAULT_RUNTIME_CAPABILITIES, resolveRuntimeConfig } from './types'

type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject
type CodexConfigObject = {
  [key: string]: CodexConfigValue
}

type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
type CodexApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never'
type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
type CodexWebSearchMode = 'disabled' | 'cached' | 'live'

export class CodexRuntimeAdapter implements AgentServiceInterface {
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
    lastAgentSessionId?: string,
    thinkingOptions?: AgentThinkingOptions
  ): Promise<AgentStream> {
    const promptBundle = resolveAgentTurnInput(prompt)
    const cwd = session.accessible_paths[0]
    if (!cwd) {
      return deferRuntimeError(new Error('No accessible paths defined for the Codex runtime session'))
    }

    const selectedModel = session.configuration?.runtime?.modelId ?? session.model
    const modelInfo = await validateModelId(selectedModel)
    if (!modelInfo.valid || !modelInfo.provider) {
      return deferRuntimeError(
        new Error(`Invalid Codex model ID '${selectedModel}': ${JSON.stringify(modelInfo.error)}`)
      )
    }

    const provider = modelInfo.provider
    const modelId = modelInfo.modelId
    if (!modelId) {
      return deferRuntimeError(new Error(`Invalid Codex model ID '${selectedModel}': missing provider model ID`))
    }
    if (provider.type !== 'openai' && provider.type !== 'openai-response') {
      return deferRuntimeError(
        new Error(
          `Provider type '${provider.type}' is not supported by the Codex runtime. Select Claude or OpenCode instead.`
        )
      )
    }

    const runtimeConfig = resolveRuntimeConfig(session)
    const promptText = buildCodexInput(getPromptText(prompt), session.instructions)
    let threadOptions: Record<string, unknown>
    let codexConfig: CodexConfigObject | undefined
    try {
      threadOptions = removeUndefinedValues({
        model: modelId,
        workingDirectory: cwd,
        additionalDirectories: session.accessible_paths.slice(1),
        sandboxMode: resolveCodexSandboxMode(runtimeConfig.sandbox?.mode),
        approvalPolicy: resolveCodexApprovalPolicy(runtimeConfig.permissions?.mode),
        networkAccessEnabled: runtimeConfig.sandbox?.networkAccess === true,
        modelReasoningEffort: resolveCodexReasoningEffort(
          (runtimeConfig as any).reasoningEffort ?? thinkingOptions?.effort
        ),
        webSearchMode: resolveCodexWebSearchMode(
          (runtimeConfig as any).webSearchMode ?? runtimeConfig.knowledge?.webSearchMode
        ),
        webSearchEnabled: resolveOptionalBoolean(
          (runtimeConfig as any).webSearchEnabled ?? runtimeConfig.knowledge?.webSearchEnabled
        ),
        skipGitRepoCheck: true
      })
      codexConfig = buildCodexConfig(runtimeConfig)
    } catch (error) {
      return deferRuntimeError(error instanceof Error ? error : new Error(String(error)))
    }

    const stream = new RuntimeAgentStream()

    void (async () => {
      try {
        const { Codex } = await import('@openai/codex-sdk')
        const codex = new Codex(
          removeUndefinedValues({
            apiKey: provider.apiKey,
            baseUrl: runtimeConfig.endpoint ?? provider.apiHost,
            config: codexConfig,
            env: {
              OPENAI_API_KEY: provider.apiKey ?? ''
            }
          })
        )

        const thread = lastAgentSessionId
          ? codex.resumeThread(lastAgentSessionId, threadOptions as any)
          : codex.startThread(threadOptions as any)
        const { events } = await thread.runStreamed(promptText, { signal: abortController.signal })

        for await (const event of events) {
          if (event.type === 'thread.started') {
            stream.sdkSessionId = event.thread_id
            emitRuntimeStatus(stream, {
              phase: 'thread.started',
              runtimeSessionId: event.thread_id,
              runtime: 'codex',
              config: {
                approvalPolicy: threadOptions.approvalPolicy,
                sandboxMode: threadOptions.sandboxMode,
                model: threadOptions.model
              },
              context: {
                skillCount: promptBundle?.context.skills.length ?? 0,
                knowledgeReferenceCount: promptBundle?.context.knowledgeReferences.length ?? 0
              }
            })
            continue
          }

          if (event.type === 'turn.started') {
            emitRuntimeStatus(stream, {
              phase: 'turn.started',
              runtime: 'codex'
            })
            continue
          }

          if (event.type === 'item.started' || event.type === 'item.completed' || event.type === 'item.updated') {
            const item = event.item as any
            if (item?.type === 'agent_message' && typeof item.text === 'string') {
              emitRuntimeText(stream, item.text)
              continue
            }
            emitRuntimeItem(stream, event.type, item)
            continue
          }

          if (event.type === 'turn.completed') {
            emitRuntimeUsage(stream, event.usage)
            stream.emitComplete()
            return
          }

          if (event.type === 'turn.failed') {
            stream.emitError(new Error(event.error?.message ?? 'Codex runtime failed'))
            return
          }

          if (event.type === 'error') {
            stream.emitError(new Error(event.message || 'Codex runtime failed'))
            return
          }
        }
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

function deferRuntimeError(error: Error): AgentStream {
  const stream = new RuntimeAgentStream()
  setTimeout(() => {
    stream.emitError(error)
  }, 0)
  return stream
}

function resolveCodexSandboxMode(value: unknown): CodexSandboxMode {
  if (value === undefined || value === null || value === '') {
    return 'workspace-write'
  }
  if (value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access') {
    return value
  }
  throw new Error(`Unsupported Codex sandbox mode '${String(value)}'`)
}

function resolveCodexApprovalPolicy(value: unknown): CodexApprovalPolicy {
  if (value === undefined || value === null || value === '') {
    return 'on-request'
  }
  if (value === 'untrusted' || value === 'on-failure' || value === 'on-request' || value === 'never') {
    return value
  }
  throw new Error(`Unsupported Codex approval policy '${String(value)}'`)
}

function resolveCodexReasoningEffort(value: unknown): CodexReasoningEffort | undefined {
  if (value === undefined || value === null || value === '' || value === 'default') {
    return undefined
  }
  if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') {
    return value
  }
  throw new Error(`Unsupported Codex reasoning effort '${String(value)}'`)
}

function resolveCodexWebSearchMode(value: unknown): CodexWebSearchMode | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (value === 'disabled' || value === 'cached' || value === 'live') {
    return value
  }
  throw new Error(`Unsupported Codex web search mode '${String(value)}'`)
}

function resolveOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function buildCodexInput(promptText: string, instructions?: string): string {
  const trimmedInstructions = instructions?.trim()
  if (!trimmedInstructions) {
    return promptText
  }

  return `<system_instructions>\n${trimmedInstructions}\n</system_instructions>\n\n<user_request>\n${promptText}\n</user_request>`
}

function buildCodexConfig(runtimeConfig: ReturnType<typeof resolveRuntimeConfig>): CodexConfigObject | undefined {
  const config: CodexConfigObject = {}
  const mcpServers = resolveCodexMcpServers(runtimeConfig.mcp)
  if (mcpServers) {
    config.mcp_servers = mcpServers
  }

  return Object.keys(config).length > 0 ? config : undefined
}

function resolveCodexMcpServers(value: unknown): CodexConfigObject | undefined {
  const mcpConfig = asRecord(value)
  if (!mcpConfig) {
    return undefined
  }

  const servers = asRecord(mcpConfig.servers) ?? asRecord(mcpConfig.mcp_servers)
  return servers ? toCodexConfigObject(servers) : undefined
}

function toCodexConfigObject(value: Record<string, unknown>): CodexConfigObject {
  const result: CodexConfigObject = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue
    result[key] = toCodexConfigValue(item)
  }
  return result
}

function toCodexConfigValue(value: unknown): CodexConfigValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(toCodexConfigValue)
  }
  const record = asRecord(value)
  if (record) {
    return toCodexConfigObject(record)
  }
  return String(value)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && (!Array.isArray(item) || item.length > 0))
  ) as T
}

function emitRuntimeText(stream: RuntimeAgentStream, text: string): void {
  stream.emitChunk({
    type: 'text-start',
    id: 'codex-text'
  } as unknown as TextStreamPart<Record<string, any>>)
  stream.emitChunk({
    type: 'text-delta',
    id: 'codex-text',
    text
  } as unknown as TextStreamPart<Record<string, any>>)
  stream.emitChunk({
    type: 'text-end',
    id: 'codex-text',
    providerMetadata: {
      text: {
        value: text
      }
    }
  } as unknown as TextStreamPart<Record<string, any>>)
}

function emitRuntimeStatus(stream: RuntimeAgentStream, data: Record<string, unknown>): void {
  stream.emitChunk({
    type: 'data-agent-runtime-status',
    data
  } as unknown as TextStreamPart<Record<string, any>>)
}

function emitRuntimeItem(
  stream: RuntimeAgentStream,
  eventType: string,
  item: Record<string, unknown> | undefined
): void {
  if (!item) {
    return
  }

  const itemType = typeof item.type === 'string' ? item.type : 'unknown'
  stream.emitChunk({
    type: isCodexToolItem(itemType) ? 'data-agent-runtime-tool' : 'data-agent-runtime-item',
    data: {
      runtime: 'codex',
      eventType,
      itemType,
      itemId: item.id,
      status: item.status,
      item
    }
  } as unknown as TextStreamPart<Record<string, any>>)
}

function emitRuntimeUsage(stream: RuntimeAgentStream, usage: unknown): void {
  stream.emitChunk({
    type: 'data-agent-runtime-usage',
    data: {
      runtime: 'codex',
      usage
    }
  } as unknown as TextStreamPart<Record<string, any>>)
}

function isCodexToolItem(itemType: string): boolean {
  return (
    itemType === 'command_execution' ||
    itemType === 'file_change' ||
    itemType === 'mcp_tool_call' ||
    itemType === 'web_search'
  )
}
