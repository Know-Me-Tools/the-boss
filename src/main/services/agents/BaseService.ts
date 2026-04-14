import { loggerService } from '@logger'
import { formatProviderApiHost } from '@main/aiCore/provider/providerConfig'
import { mcpApiService } from '@main/apiServer/services/mcp'
import type { ModelValidationError } from '@main/apiServer/utils'
import { validateModelId } from '@main/apiServer/utils'
import { resolveAnthropicAuthToken } from '@main/services/AnthropicAuthResolver'
import { reduxService } from '@main/services/ReduxService'
import { getDataPath } from '@main/utils'
import { buildFunctionCallToolName } from '@shared/mcp'
import type {
  AgentType,
  ApiClient,
  KnowledgeBase,
  MCPTool,
  Provider,
  SlashCommand,
  SystemProviderId,
  Tool
} from '@types'
import { objectKeys } from '@types'
import fs from 'fs'
import path from 'path'

import { serviceRegistryService } from '../ServiceRegistryService'
import { DatabaseManager } from './database/DatabaseManager'
import type { AgentModelField } from './errors'
import { AgentModelValidationError } from './errors'
import { builtinSlashCommands } from './services/claudecode/commands'
import { builtinTools } from './services/claudecode/tools'

const logger = loggerService.withContext('BaseService')
const MCP_TOOL_ID_PREFIX = 'mcp__'
const MCP_TOOL_LEGACY_PREFIX = 'mcp_'
type KnowledgeBaseRuntimeConfig = Record<
  string,
  {
    embedApiClient: ApiClient
    rerankApiClient?: ApiClient
  }
>

const buildMcpToolId = (serverId: string, toolName: string) => `${MCP_TOOL_ID_PREFIX}${serverId}__${toolName}`
const toLegacyMcpToolId = (toolId: string) => {
  if (!toolId.startsWith(MCP_TOOL_ID_PREFIX)) {
    return null
  }
  const rawId = toolId.slice(MCP_TOOL_ID_PREFIX.length)
  return `${MCP_TOOL_LEGACY_PREFIX}${rawId.replace(/__/g, '_')}`
}

/**
 * Base service class providing shared utilities for all agent-related services.
 *
 * Features:
 * - Database access through DatabaseManager singleton
 * - JSON field serialization/deserialization
 * - Path validation and creation
 * - Model validation
 * - MCP tools and slash commands listing
 */
export abstract class BaseService {
  protected jsonFields: string[] = [
    'tools',
    'mcps',
    'configuration',
    'accessible_paths',
    'allowed_tools',
    'slash_commands',
    'knowledge_bases',
    'knowledge_base_configs'
  ]

  private routeKnowledgeApiHost(apiHost: string): string {
    const trimmedHost = apiHost.trim()
    if (!trimmedHost.endsWith('#')) {
      return trimmedHost.replace(/\/+$/, '')
    }

    const hostWithoutMarker = trimmedHost.slice(0, -1)
    const endpointMatch = ['/v1', '/v1beta', '/openai', '/api'].find((endpoint) => hostWithoutMarker.endsWith(endpoint))
    if (!endpointMatch) {
      return hostWithoutMarker.replace(/\/+$/, '')
    }

    return hostWithoutMarker
      .slice(0, hostWithoutMarker.length - endpointMatch.length)
      .replace(/\/+$/, '')
      .replace(/:$/, '')
  }

  private buildKnowledgeApiClient(modelId: string | undefined, provider: Provider): ApiClient {
    let baseURL = this.routeKnowledgeApiHost(provider.apiHost || '')

    if (provider.type === 'gemini') {
      baseURL = `${baseURL}/openai`
    } else if (provider.type === 'azure-openai') {
      baseURL = `${baseURL}/v1`
    } else if (provider.id === 'ollama') {
      baseURL = baseURL.replace(/\/api$/, '')
    }

    return {
      model: modelId || '',
      provider: provider.id,
      apiKey: provider.apiKey || provider.id || 'secret',
      baseURL
    }
  }

  protected async buildKnowledgeBaseRuntimeConfigs(
    knowledgeBases?: KnowledgeBase[]
  ): Promise<KnowledgeBaseRuntimeConfig | undefined> {
    if (!knowledgeBases?.length) {
      return undefined
    }

    let providers: Provider[] = []
    try {
      const rawProviders = await reduxService.select<Provider[]>('state.llm.providers')
      const formatted = await Promise.allSettled(
        (rawProviders || []).map((provider) => formatProviderApiHost(provider))
      )
      providers = formatted.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    } catch (error) {
      logger.warn('Failed to resolve provider snapshots for knowledge bases', {
        error: error instanceof Error ? error.message : String(error)
      })
      return undefined
    }

    const providerMap = new Map(providers.map((provider) => [provider.id, provider]))
    const configs: KnowledgeBaseRuntimeConfig = {}

    for (const base of knowledgeBases) {
      const embedProvider = providerMap.get(base.model?.provider)
      if (!embedProvider) {
        logger.warn('Skipping knowledge runtime config due to missing embedding provider', {
          baseId: base.id,
          providerId: base.model?.provider
        })
        continue
      }

      configs[base.id] = {
        embedApiClient: this.buildKnowledgeApiClient(base.model?.id, embedProvider)
      }

      if (base.rerankModel?.provider) {
        const rerankProvider = providerMap.get(base.rerankModel.provider)
        if (rerankProvider) {
          configs[base.id].rerankApiClient = this.buildKnowledgeApiClient(base.rerankModel.id, rerankProvider)
        }
      }
    }

    return Object.keys(configs).length > 0 ? configs : undefined
  }

  protected stripInternalAgentFields<T extends Record<string, unknown>>(entity: T): T {
    const sanitized = { ...entity }
    delete (sanitized as Record<string, unknown>).knowledge_base_configs
    return sanitized
  }

  public async listMcpTools(
    agentType: AgentType,
    ids?: string[]
  ): Promise<{ tools: Tool[]; legacyIdMap: Map<string, string> }> {
    const tools: Tool[] = []
    const legacyIdMap = new Map<string, string>()
    if (agentType === 'claude-code') {
      tools.push(...builtinTools)
    }
    if (ids && ids.length > 0) {
      for (const id of ids) {
        try {
          const server = await mcpApiService.getServerInfo(id)
          if (server) {
            server.tools.forEach((tool: MCPTool) => {
              const canonicalId = buildFunctionCallToolName(server.name, tool.name)
              const serverIdBasedId = buildMcpToolId(id, tool.name)
              const legacyId = toLegacyMcpToolId(serverIdBasedId)

              tools.push({
                id: canonicalId,
                name: tool.name,
                type: 'mcp',
                description: tool.description || '',
                requirePermissions: true
              })
              legacyIdMap.set(serverIdBasedId, canonicalId)
              if (legacyId) {
                legacyIdMap.set(legacyId, canonicalId)
              }
            })
          }
        } catch (error) {
          logger.warn('Failed to list MCP tools', {
            id,
            error: error as Error
          })
        }
      }
    }

    try {
      const serviceTools = await serviceRegistryService.listProjectedTools()
      for (const serviceTool of serviceTools) {
        tools.push({
          id: serviceTool.id,
          name: serviceTool.name,
          type: 'service',
          description: serviceTool.description || `Projected service tool from ${serviceTool.serviceName}`,
          requirePermissions: true,
          serviceId: serviceTool.serviceId,
          serviceName: serviceTool.serviceName,
          serviceKind: serviceTool.serviceKind,
          projectionKind: serviceTool.projectionKind
        })
      }
    } catch (error) {
      logger.warn('Failed to list projected service tools', {
        error: error as Error
      })
    }

    return { tools, legacyIdMap }
  }

  /**
   * Normalize MCP tool IDs in allowed_tools to the current format.
   *
   * Legacy formats:
   * - "mcp__<serverId>__<toolName>" (double underscore separators, server ID based)
   * - "mcp_<serverId>_<toolName>" (single underscore separators)
   * Current format: "mcp__<serverName>__<toolName>" (double underscore separators).
   *
   * This keeps persisted data compatible without requiring a database migration.
   */
  protected normalizeAllowedTools(
    allowedTools: string[] | undefined,
    tools: Tool[],
    legacyIdMap?: Map<string, string>
  ): string[] | undefined {
    if (!allowedTools || allowedTools.length === 0) {
      return allowedTools
    }

    const resolvedLegacyIdMap = new Map<string, string>()

    if (legacyIdMap) {
      for (const [legacyId, canonicalId] of legacyIdMap) {
        resolvedLegacyIdMap.set(legacyId, canonicalId)
      }
    }

    for (const tool of tools) {
      if (tool.type !== 'mcp') {
        continue
      }
      const legacyId = toLegacyMcpToolId(tool.id)
      if (!legacyId) {
        continue
      }
      resolvedLegacyIdMap.set(legacyId, tool.id)
    }

    if (resolvedLegacyIdMap.size === 0) {
      return allowedTools
    }

    const normalized = allowedTools.map((toolId) => resolvedLegacyIdMap.get(toolId) ?? toolId)
    return Array.from(new Set(normalized))
  }

  public async listSlashCommands(agentType: AgentType): Promise<SlashCommand[]> {
    if (agentType === 'claude-code') {
      return builtinSlashCommands
    }
    return []
  }

  /**
   * Get database instance
   * Automatically waits for initialization to complete
   */
  public async getDatabase() {
    const dbManager = await DatabaseManager.getInstance()
    return dbManager.getDatabase()
  }

  protected serializeJsonFields(data: any): any {
    const serialized = { ...data }

    for (const field of this.jsonFields) {
      if (serialized[field] !== undefined) {
        serialized[field] =
          Array.isArray(serialized[field]) || typeof serialized[field] === 'object'
            ? JSON.stringify(serialized[field])
            : serialized[field]
      }
    }

    return serialized
  }

  protected deserializeJsonFields(data: any): any {
    if (!data) return data

    const deserialized = { ...data }

    for (const field of this.jsonFields) {
      if (deserialized[field] && typeof deserialized[field] === 'string') {
        try {
          deserialized[field] = JSON.parse(deserialized[field])
        } catch (error) {
          logger.warn(`Failed to parse JSON field ${field}:`, error as Error)
        }
      }
    }

    // Normalize legacy agent type values to the unified type
    if (deserialized.type === 'cherry-claw') {
      deserialized.type = 'claude-code'
    }
    if (deserialized.agent_type === 'cherry-claw') {
      deserialized.agent_type = 'claude-code'
    }

    // convert null from db to undefined to satisfy type definition
    for (const key of objectKeys(data)) {
      if (deserialized[key] === null) {
        deserialized[key] = undefined
      }
    }

    return deserialized
  }

  /**
   * Validate, normalize, and ensure filesystem access for a set of absolute paths.
   *
   * - Requires every entry to be an absolute path and throws if not.
   * - Normalizes each path and deduplicates while preserving order.
   * - Creates missing directories (or parent directories for file-like paths).
   */
  protected ensurePathsExist(paths?: string[]): string[] {
    if (!paths?.length) {
      return []
    }

    const sanitizedPaths: string[] = []
    const seenPaths = new Set<string>()

    for (const rawPath of paths) {
      if (!rawPath) {
        continue
      }

      if (!path.isAbsolute(rawPath)) {
        throw new Error(`Accessible path must be absolute: ${rawPath}`)
      }

      // Normalize to provide consistent values to downstream consumers.
      const resolvedPath = path.normalize(rawPath)

      let stats: fs.Stats | null = null
      try {
        // Attempt to stat the path to understand whether it already exists and if it is a file.
        if (fs.existsSync(resolvedPath)) {
          stats = fs.statSync(resolvedPath)
        }
      } catch (error) {
        logger.warn('Failed to inspect accessible path', {
          path: rawPath,
          error: error instanceof Error ? error.message : String(error)
        })
      }

      const looksLikeFile =
        (stats && stats.isFile()) || (!stats && path.extname(resolvedPath) !== '' && !resolvedPath.endsWith(path.sep))

      // For file-like targets create the parent directory; otherwise ensure the directory itself.
      const directoryToEnsure = looksLikeFile ? path.dirname(resolvedPath) : resolvedPath

      if (!fs.existsSync(directoryToEnsure)) {
        try {
          fs.mkdirSync(directoryToEnsure, { recursive: true })
        } catch (error) {
          logger.error('Failed to create accessible path directory', {
            path: directoryToEnsure,
            error: error instanceof Error ? error.message : String(error)
          })
          throw error
        }
      }

      // Preserve the first occurrence only to avoid duplicates while keeping caller order stable.
      if (!seenPaths.has(resolvedPath)) {
        seenPaths.add(resolvedPath)
        sanitizedPaths.push(resolvedPath)
      }
    }

    return sanitizedPaths
  }

  /**
   * Resolve accessible paths, assigning a default workspace under `{dataPath}/Agents/{id}`
   * when the provided paths are empty or undefined, then ensure all directories exist.
   */
  protected resolveAccessiblePaths(paths: string[] | undefined, id: string): string[] {
    if (!paths || paths.length === 0) {
      const shortId = id.substring(id.length - 9)
      paths = [path.join(getDataPath(), 'Agents', shortId)]
    }
    return this.ensurePathsExist(paths)
  }

  /**
   * Validate agent model configuration.
   *
   * **Side effect**: For local providers that don't require a real API key
   * (e.g. ollama, lmstudio), this method sets `provider.apiKey` to the
   * provider ID as a placeholder so downstream SDK calls don't reject the
   * request. Callers should be aware that the provider object may be mutated.
   */
  protected async validateAgentModels(
    agentType: AgentType,
    models: Partial<Record<AgentModelField, string | undefined>>
  ): Promise<void> {
    const entries = Object.entries(models) as [AgentModelField, string | undefined][]
    if (entries.length === 0) {
      return
    }

    // Local providers that don't require a real API key (use placeholder).
    // Note: lmstudio doesn't support Anthropic API format, only ollama does.
    const localProvidersWithoutApiKey: readonly string[] = ['ollama', 'lmstudio'] satisfies SystemProviderId[]

    for (const [field, rawValue] of entries) {
      if (rawValue === undefined || rawValue === null) {
        continue
      }

      const modelValue = rawValue
      const validation = await validateModelId(modelValue)

      if (!validation.valid || !validation.provider) {
        const detail: ModelValidationError = validation.error ?? {
          type: 'invalid_format',
          message: 'Unknown model validation error',
          code: 'validation_error'
        }

        throw new AgentModelValidationError({ agentType, field, model: modelValue }, detail)
      }

      const requiresApiKey = !localProvidersWithoutApiKey.includes(validation.provider.id)
      const anthropicAuthToken = await resolveAnthropicAuthToken(validation.provider)

      if (!validation.provider.apiKey) {
        if (anthropicAuthToken) {
          continue
        }

        if (requiresApiKey) {
          throw new AgentModelValidationError(
            { agentType, field, model: modelValue },
            {
              type: 'invalid_format',
              message: `Provider '${validation.provider.id}' is missing an API key`,
              code: 'provider_api_key_missing'
            }
          )
        } else {
          // Use provider id as placeholder API key for providers that don't require one
          validation.provider.apiKey = validation.provider.id
        }
      }
    }
  }
}
