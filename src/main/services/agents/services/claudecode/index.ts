// src/main/services/agents/services/claudecode/index.ts
import { fork } from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import type {
  CanUseTool,
  HookCallback,
  McpHttpServerConfig,
  Options,
  SdkPluginConfig,
  SDKUserMessage,
  SpawnedProcess
} from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Base64ImageSource, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import { loggerService } from '@logger'
import { config as apiConfigService } from '@main/apiServer/config'
import { validateModelId } from '@main/apiServer/utils'
import { isWin } from '@main/constant'
import AssistantServer from '@main/mcpServers/assistant'
import BrowserServer from '@main/mcpServers/browser/server'
import ClawServer from '@main/mcpServers/claw'
import SkillsServer from '@main/mcpServers/skills'
import WorkspaceMemoryServer from '@main/mcpServers/workspaceMemory'
import { resolveClaudeCodeAnthropicCredentials } from '@main/services/AnthropicAuthResolver'
import { configManager } from '@main/services/ConfigManager'
import {
  getNodeProxyConfigFromEnvironment,
  getProxyEnvironment,
  getProxyProtocol
} from '@main/services/proxy/nodeProxy'
import { toAsarUnpackedPath } from '@main/utils'
import { autoDiscoverGitBash, getBinaryPath } from '@main/utils/process'
import { rtkRewrite } from '@main/utils/rtk'
import getLoginShellEnvironment from '@main/utils/shell-env'
import {
  CHANNEL_SECURITY_PROMPT,
  GLOBALLY_DISALLOWED_TOOLS,
  SOUL_MODE_DISALLOWED_TOOLS
} from '@shared/agents/claudecode/constants'
import { languageEnglishNameMap } from '@shared/config/languages'
import { withoutTrailingApiVersion } from '@shared/utils'
import { app } from 'electron'

import type { GetAgentSessionResponse } from '../..'
import type {
  AgentServiceInterface,
  AgentStream,
  AgentStreamEvent,
  AgentThinkingOptions
} from '../../interfaces/AgentStreamInterface'
import { skillService } from '../../skills/SkillService'
import { agentService } from '../AgentService'
import { isProvisioned, provisionBuiltinAgent } from '../builtin/BuiltinAgentProvisioner'
import { channelService } from '../ChannelService'
import { PromptBuilder } from '../cherryclaw/prompt'
import { type AgentTurnInput, getPromptText } from '../runtime/RuntimeContextBundle'
import { sessionService } from '../SessionService'
import { buildNamespacedToolCallId } from './claude-stream-state'
import { resolveClaudeCodeProviderRoute } from './providerRoutes'
import {
  type ClaudeStreamTimeout,
  createOneShotUserMessageStream,
  createStreamWatchdog,
  destroyClaudeChildProcess
} from './streamSafety'
import { promptForToolApproval } from './tool-permissions'
import { ClaudeStreamState, transformSDKMessageToStreamParts } from './transform'

const require_ = createRequire(import.meta.url)
const logger = loggerService.withContext('ClaudeCodeService')
const promptBuilder = new PromptBuilder()
const DEFAULT_AUTO_ALLOW_TOOLS = new Set(['Read', 'Glob', 'Grep'])
const IMAGE_MAX_DIMENSION = 2000
const IMAGE_MAX_BYTES = 5 * 1024 * 1024 // 5MB API limit
const CLAUDE_FIRST_BYTE_TIMEOUT_MS = 45_000
const CLAUDE_INACTIVITY_TIMEOUT_MS = 180_000
const CLAUDE_MAX_SDK_MESSAGES = 20_000
const CLAUDE_CHILD_KILL_GRACE_MS = 2_000
const shouldAutoApproveTools = process.env.CHERRY_AUTO_ALLOW_TOOLS === '1'
const NO_RESUME_COMMANDS = ['/clear']

const getLanguageInstruction = () => {
  const lang = configManager.getLanguage()
  return `
  IMPORTANT: You MUST use ${languageEnglishNameMap[lang]} language for ALL your outputs, including:
  (1) text responses, (2) tool call parameters like "description" fields, and (3) any user-facing content.
  ${lang === 'en-US' ? '' : 'Never use English unless the content is code, file paths, or technical identifiers.'}
  `
}

type UserInputMessage = SDKUserMessage

class ClaudeCodeStream extends EventEmitter implements AgentStream {
  declare emit: (event: 'data', data: AgentStreamEvent) => boolean
  declare on: (event: 'data', listener: (data: AgentStreamEvent) => void) => this
  declare once: (event: 'data', listener: (data: AgentStreamEvent) => void) => this
  /** SDK session_id captured from the init message, used for resume. */
  sdkSessionId?: string
}

class ClaudeCodeService implements AgentServiceInterface {
  private claudeExecutablePath: string
  private claudeProxyBootstrapPath: string

  constructor() {
    // Resolve Claude Code CLI robustly (works in dev and in asar)
    this.claudeExecutablePath = toAsarUnpackedPath(
      path.join(path.dirname(require_.resolve('@anthropic-ai/claude-agent-sdk')), 'cli.js')
    )
    this.claudeProxyBootstrapPath = toAsarUnpackedPath(path.join(app.getAppPath(), 'out', 'proxy', 'index.js'))
  }

  async invoke(
    prompt: AgentTurnInput,
    session: GetAgentSessionResponse,
    abortController: AbortController,
    lastAgentSessionId?: string,
    thinkingOptions?: AgentThinkingOptions,
    images?: Array<{ data: string; media_type: string }>
  ): Promise<AgentStream> {
    const aiStream = new ClaudeCodeStream()
    const promptText = getPromptText(prompt)

    // Validate session accessible paths and make sure it exists as a directory
    const cwd = session.accessible_paths[0]
    if (!cwd) {
      aiStream.emit('data', {
        type: 'error',
        error: new Error('No accessible paths defined for the agent session')
      })
      return aiStream
    }

    // Sync per-agent skill symlinks in this workspace with the `agent_skills`
    // DB state before we spin up the SDK. This repairs drift from external
    // edits (user deleted a symlink, workspace was moved, etc.) so Claude
    // Code sees exactly the set of skills the agent should have enabled.
    try {
      await skillService.reconcileAgentSkills(session.agent_id, cwd)
    } catch (error) {
      logger.warn('Failed to reconcile agent skills before session start', {
        agentId: session.agent_id,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    // Validate model info
    const modelInfo = await validateModelId(session.model)
    if (!modelInfo.valid) {
      aiStream.emit('data', {
        type: 'error',
        error: new Error(`Invalid model ID '${session.model}': ${JSON.stringify(modelInfo.error)}`)
      })
      return aiStream
    }
    const provider = modelInfo.provider
    if (!provider) {
      aiStream.emit('data', {
        type: 'error',
        error: new Error('Provider not found for model')
      })
      return aiStream
    }

    const providerRoute = resolveClaudeCodeProviderRoute(provider)
    if (!providerRoute) {
      logger.error('Provider route is unsupported for Claude Code runtime', { modelInfo })
      aiStream.emit('data', {
        type: 'error',
        error: new Error(
          `Provider type '${provider.type}' is not supported by the Claude runtime. Select the Codex or OpenCode runtime for this provider instead.`
        )
      })
      return aiStream
    }

    // Providers like Ollama and LM Studio don't require real API keys,
    // but the Claude Agent SDK needs a non-empty placeholder value.
    if (!provider.apiKey && (provider.id === 'ollama' || provider.id === 'lmstudio')) {
      provider.apiKey = provider.id
    }

    const apiConfig = await apiConfigService.get()
    const loginShellEnv = await getLoginShellEnvironment()

    // Auto-discover Git Bash path on Windows (already logs internally)
    const customGitBashPath = isWin ? autoDiscoverGitBash() : null
    const bunPath = await getBinaryPath('bun')

    // Claude Agent SDK builds the final endpoint as `${ANTHROPIC_BASE_URL}/v1/messages`.
    // To avoid malformed URLs like `/v1/v1/messages`, we normalize the provider host
    // by stripping any trailing API version (e.g. `/v1`).
    // For Azure OpenAI providers, the Anthropic endpoint lives under /anthropic.
    const resolveAnthropicBaseUrl = (): string => {
      if (provider.type === 'azure-openai') {
        const host = withoutTrailingApiVersion(provider.apiHost).replace(/\/openai$/, '')
        return `${host}/anthropic`
      }
      return withoutTrailingApiVersion(provider.anthropicApiHost?.trim() || provider.apiHost)
    }
    const anthropicBaseUrl = resolveAnthropicBaseUrl()
    const nativeAnthropicCredentials = await resolveClaudeCodeAnthropicCredentials(provider)
    const anthropicApiKey = nativeAnthropicCredentials?.apiKey ?? ''
    const anthropicAuthToken = nativeAnthropicCredentials?.authToken ?? nativeAnthropicCredentials?.apiKey ?? ''

    const env = {
      ...loginShellEnv,
      ...getProxyEnvironment(process.env),
      // prevent claude agent sdk using bedrock api
      CLAUDE_CODE_USE_BEDROCK: '0',
      ANTHROPIC_API_KEY: anthropicApiKey,
      ANTHROPIC_AUTH_TOKEN: anthropicAuthToken,
      ANTHROPIC_BASE_URL: anthropicBaseUrl,
      ANTHROPIC_MODEL: modelInfo.modelId,
      ANTHROPIC_DEFAULT_OPUS_MODEL: modelInfo.modelId,
      ANTHROPIC_DEFAULT_SONNET_MODEL: modelInfo.modelId,
      // TODO: support set small model in UI
      ANTHROPIC_DEFAULT_HAIKU_MODEL: modelInfo.modelId,
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      // Set CLAUDE_CONFIG_DIR to app's userData directory to avoid path encoding issues
      // on Windows when the username contains non-ASCII characters (e.g., Chinese characters)
      // This prevents the SDK from using the user's home directory which may have encoding problems.
      // Per-agent skills live in `<cwd>/.claude/skills/` and are picked up by the SDK's
      // project-level skill loading layer — no need to point CLAUDE_CONFIG_DIR at the workspace.
      CLAUDE_CONFIG_DIR: path.join(app.getPath('userData'), '.claude'),
      ENABLE_TOOL_SEARCH: 'auto',
      CHERRY_STUDIO_BUN_PATH: bunPath,
      ...(customGitBashPath ? { CLAUDE_CODE_GIT_BASH_PATH: customGitBashPath } : {})
    }

    // Merge user-defined environment variables from session configuration
    const userEnvVars = session.configuration?.env_vars
    if (userEnvVars && typeof userEnvVars === 'object') {
      const BLOCKED_ENV_KEYS = new Set([
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_MODEL',
        'ANTHROPIC_DEFAULT_OPUS_MODEL',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL',
        'ELECTRON_RUN_AS_NODE',
        'ELECTRON_NO_ATTACH_CONSOLE',
        'CLAUDE_CONFIG_DIR',
        'CLAUDE_CODE_USE_BEDROCK',
        'CLAUDE_CODE_GIT_BASH_PATH',
        'CHERRY_STUDIO_NODE_PROXY_RULES',
        'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES',
        'NODE_OPTIONS',
        '__PROTO__',
        'CONSTRUCTOR',
        'PROTOTYPE'
      ])
      for (const [key, value] of Object.entries(userEnvVars)) {
        const upperKey = key.toUpperCase()
        if (BLOCKED_ENV_KEYS.has(upperKey)) {
          logger.warn('Blocked user env var override for system-critical variable', { key })
        } else if (typeof value === 'string') {
          env[key] = value
        }
      }
    }

    const errorChunks: string[] = []

    const sessionAllowedTools = new Set<string>(session.allowed_tools ?? [])
    const autoAllowTools = new Set<string>([...DEFAULT_AUTO_ALLOW_TOOLS, ...sessionAllowedTools])
    const normalizeToolName = (name: string) => (name.startsWith('builtin_') ? name.slice('builtin_'.length) : name)

    let plugins: SdkPluginConfig[] | undefined
    try {
      const pluginsDir = path.join(cwd, '.claude', 'plugins')
      const entries = await fs.promises.readdir(pluginsDir, { withFileTypes: true }).catch(() => [])
      const pluginPaths: string[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const manifestPath = path.join(pluginsDir, entry.name, '.claude-plugin', 'plugin.json')
        try {
          await fs.promises.access(manifestPath, fs.constants.R_OK)
          pluginPaths.push(path.join(pluginsDir, entry.name))
        } catch {
          // No manifest, skip
        }
      }
      if (pluginPaths.length > 0) {
        plugins = pluginPaths.map((pluginPath) => ({
          type: 'local',
          path: pluginPath
        }))
      }
    } catch (error) {
      logger.warn('Failed to load plugin packages for Claude Code', {
        agentId: session.agent_id,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    const canUseTool: CanUseTool = async (toolName, input, options) => {
      logger.info('Handling tool permission check', {
        toolName,
        suggestionCount: options.suggestions?.length ?? 0
      })

      if (shouldAutoApproveTools) {
        logger.debug('Auto-approving tool due to CHERRY_AUTO_ALLOW_TOOLS flag', { toolName })
        return { behavior: 'allow', updatedInput: input }
      }

      if (options.signal.aborted) {
        logger.debug('Permission request signal already aborted; denying tool', { toolName })
        return {
          behavior: 'deny',
          message: 'Tool request was cancelled before prompting the user'
        }
      }

      const normalizedToolName = normalizeToolName(toolName)
      if (autoAllowTools.has(toolName) || autoAllowTools.has(normalizedToolName)) {
        logger.debug('Auto-allowing tool from allowed list', {
          toolName,
          normalizedToolName
        })
        return { behavior: 'allow', updatedInput: input }
      }

      return promptForToolApproval(toolName, input, {
        ...options,
        toolCallId: buildNamespacedToolCallId(session.id, options.toolUseID)
      })
    }

    const preToolUseHook: HookCallback = async (input, toolUseID, options) => {
      // Type guard to ensure we're handling PreToolUse event
      if (input.hook_event_name !== 'PreToolUse') {
        return {}
      }

      const hookInput = input
      const toolName = hookInput.tool_name

      logger.debug('PreToolUse hook triggered', {
        session_id: hookInput.session_id,
        tool_name: hookInput.tool_name,
        tool_use_id: toolUseID,
        tool_input: hookInput.tool_input,
        cwd: hookInput.cwd,
        permission_mode: hookInput.permission_mode,
        autoAllowTools: autoAllowTools
      })

      if (options?.signal?.aborted) {
        logger.debug('PreToolUse hook signal already aborted; skipping tool use', {
          tool_name: hookInput.tool_name
        })
        return {}
      }

      // handle auto approved tools since it never triggers canUseTool
      const normalizedToolName = normalizeToolName(toolName)
      if (toolUseID) {
        const bypassAll = input.permission_mode === 'bypassPermissions'
        const autoAllowed = autoAllowTools.has(toolName) || autoAllowTools.has(normalizedToolName)
        if (bypassAll || autoAllowed) {
          const namespacedToolCallId = buildNamespacedToolCallId(session.id, toolUseID)
          logger.debug('handling auto approved tools', {
            toolName,
            normalizedToolName,
            namespacedToolCallId,
            permission_mode: input.permission_mode,
            autoAllowTools
          })
          const isRecord = (v: unknown): v is Record<string, unknown> => {
            return !!v && typeof v === 'object' && !Array.isArray(v)
          }
          const toolInput = isRecord(input.tool_input) ? input.tool_input : {}

          await promptForToolApproval(toolName, toolInput, {
            ...options,
            toolCallId: namespacedToolCallId,
            autoApprove: true
          })
        }
      }

      // Return to proceed without modification
      return {}
    }

    const rtkRewriteHook: HookCallback = async (input) => {
      if (input.hook_event_name !== 'PreToolUse') {
        return {}
      }

      // Only rewrite Bash tool commands
      if (input.tool_name !== 'Bash' && input.tool_name !== 'builtin_Bash') {
        return {}
      }

      const toolInput = input.tool_input as Record<string, unknown> | undefined
      const command = toolInput?.command
      if (typeof command !== 'string' || !command.trim()) {
        return {}
      }

      const rewritten = await rtkRewrite(command)
      if (!rewritten) {
        return {}
      }

      logger.info('rtk rewrote Bash command', { original: command, rewritten })

      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: { ...toolInput, command: rewritten }
        }
      }
    }

    // Soul Mode: read soul_enabled from agent-level configuration (not session)
    const agent = await agentService.getAgent(session.agent_id)
    const agentConfig = agent?.configuration
    const soulEnabled = agentConfig?.soul_enabled === true
    let soulSystemPrompt: string | undefined

    if (soulEnabled && cwd) {
      soulSystemPrompt = await promptBuilder.buildSystemPrompt(cwd, agentConfig)
      logger.info('Built Soul Mode system prompt', {
        cwd,
        promptLength: soulSystemPrompt.length
      })
    }

    // Inject channel security policy into system prompt when session is from an external channel
    const linkedChannel = await channelService.findBySessionId(session.id)
    const isChannelSession = !!linkedChannel
    const channelSecurityBlock = isChannelSession ? `\n\n${CHANNEL_SECURITY_PROMPT}` : ''

    // Built-in agent mode: check builtin_role in configuration
    const builtinRole = (session.configuration as Record<string, unknown> | undefined)?.builtin_role as
      | string
      | undefined
    const isAssistant = builtinRole === 'assistant'

    // For non-Soul, non-Assistant agents we still want the model to know how
    // to use the skills + memory MCP servers we inject for everyone, plus the
    // shared web tool strategy. This is a lightweight strategy suffix that
    // sits on top of the SDK's `claude_code` preset rather than replacing it.
    // Soul agents already get the full guidance via `soulSystemPrompt`, and
    // Boss Assistant has its own specialized prompt path.
    const nonSoulToolGuidance = !soulEnabled && !isAssistant ? promptBuilder.buildToolGuidance() : ''

    // Recall side of the cross-session learning loop for non-Soul agents:
    // load `memory/FACT.md` (written via the memory tool in previous sessions)
    // back into the system prompt so the agent remembers what it learned.
    // Soul agents already get this via `soulSystemPrompt`'s memories section.
    const nonSoulFactsRecall =
      !soulEnabled && !isAssistant && cwd ? await promptBuilder.buildFactsSection(cwd) : undefined

    // Provision built-in agent workspace (copy skills/plugins to working directory)
    if (builtinRole && cwd && !isProvisioned(cwd)) {
      const agentConfig = await provisionBuiltinAgent(cwd, builtinRole)
      if (agentConfig?.instructions && !session.instructions) {
        session = { ...session, instructions: agentConfig.instructions }
      }
      logger.info('Provisioned builtin agent workspace', { builtinRole, cwd })
    }

    // Build lightweight environment snapshot for Boss Assistant
    let assistantSystemPrompt: string | undefined
    if (isAssistant) {
      try {
        const context = await buildAssistantContext()
        assistantSystemPrompt = session.instructions ? `${session.instructions}\n\n${context}` : context
      } catch (err) {
        logger.warn('Failed to build assistant context', { error: err })
        assistantSystemPrompt = session.instructions
      }
    }

    // Build SDK options from session configuration
    let activeClaudeChild: SpawnedProcess | undefined
    const options: Options = {
      abortController,
      cwd,
      env,
      // model: modelInfo.modelId,
      pathToClaudeCodeExecutable: this.claudeExecutablePath,
      spawnClaudeCodeProcess: (spawnOptions) => {
        const childEnv = { ...spawnOptions.env } as NodeJS.ProcessEnv

        // Ensure the child process can resolve native modules (e.g. @img/sharp)
        // that live in asar.unpacked alongside the SDK
        childEnv.NODE_PATH = toAsarUnpackedPath(path.join(app.getAppPath(), 'node_modules'))

        let execArgv = process.execArgv

        const activeProxyConfig = getNodeProxyConfigFromEnvironment(childEnv)
        if (activeProxyConfig) {
          const proxyProtocol = getProxyProtocol(activeProxyConfig.proxyRules)

          logger.info('Injecting proxy into Claude Code child process', {
            proxyProtocol,
            proxyRules: activeProxyConfig.proxyRules,
            proxyBypassRules: activeProxyConfig.proxyBypassRules,
            proxyBootstrapPath: this.claudeProxyBootstrapPath
          })

          execArgv = [...process.execArgv, '--disable-warning=UNDICI-EHPA', '--require', this.claudeProxyBootstrapPath]
        }

        const child = fork(spawnOptions.args[0], spawnOptions.args.slice(1), {
          cwd: spawnOptions.cwd,
          env: childEnv,
          execArgv,
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          signal: spawnOptions.signal
        })
        child.stderr?.on('data', (data: Buffer) => {
          const text = data.toString()
          logger.warn('claude stderr', { chunk: text })
          errorChunks.push(text)
        })
        activeClaudeChild = child as unknown as SpawnedProcess
        const cleanupChild = () => {
          logger.warn('Destroying Claude Code child process after abort', {
            reason: abortController.signal.reason instanceof Error ? abortController.signal.reason.message : 'aborted'
          })
          destroyClaudeChildProcess(activeClaudeChild, 'abort', CLAUDE_CHILD_KILL_GRACE_MS)
          activeClaudeChild = undefined
        }
        if (abortController.signal.aborted) {
          cleanupChild()
        } else {
          abortController.signal.addEventListener('abort', cleanupChild, { once: true })
          child.once('exit', () => {
            abortController.signal.removeEventListener('abort', cleanupChild)
            activeClaudeChild = undefined
          })
        }
        return child as unknown as SpawnedProcess
      },
      systemPrompt: assistantSystemPrompt
        ? assistantSystemPrompt
        : soulSystemPrompt
          ? `${soulSystemPrompt}${channelSecurityBlock}\n\n${getLanguageInstruction()}`
          : {
              type: 'preset',
              preset: 'claude_code',
              append:
                [nonSoulToolGuidance, nonSoulFactsRecall, session.instructions].filter(Boolean).join('\n\n') +
                `${channelSecurityBlock}\n\n${getLanguageInstruction()}`
            },
      // Built-in agents skip CLAUDE.md loading to save tokens
      settingSources: builtinRole ? [] : ['project', 'local'],
      includePartialMessages: true,
      permissionMode: session.configuration?.permission_mode,
      maxTurns: session.configuration?.max_turns,
      allowedTools: session.allowed_tools,
      plugins,
      canUseTool,
      hooks: {
        PreToolUse: [
          {
            hooks: [rtkRewriteHook, preToolUseHook]
          }
        ]
      },
      disallowedTools: [
        ...GLOBALLY_DISALLOWED_TOOLS,
        ...(soulEnabled ? SOUL_MODE_DISALLOWED_TOOLS : []),
        // Boss Assistant is a read-only guide; it should not ask users questions via tool
        ...(isAssistant ? ['AskUserQuestion'] : [])
      ],
      ...(thinkingOptions?.effort ? { effort: thinkingOptions.effort } : {}),
      ...(thinkingOptions?.thinking ? { thinking: thinkingOptions.thinking } : {})
    }

    if (session.accessible_paths.length > 1) {
      options.additionalDirectories = session.accessible_paths.slice(1)
    }

    if (session.mcps && session.mcps.length > 0) {
      // mcp configs
      const mcpList: Record<string, McpHttpServerConfig> = {}
      for (const mcpId of session.mcps) {
        mcpList[mcpId] = {
          type: 'http',
          url: `http://${apiConfig.host}:${apiConfig.port}/v1/mcps/${mcpId}/mcp`,
          headers: {
            Authorization: `Bearer ${apiConfig.apiKey}`
          }
        }
      }
      options.mcpServers = mcpList
      options.strictMcpConfig = true
    }

    // Inject @cherry/browser MCP for all agents (replaces SDK built-in WebSearch/WebFetch)
    if (!options.mcpServers) options.mcpServers = {}
    const browserServer = new BrowserServer()
    options.mcpServers.browser = {
      type: 'sdk',
      name: '@cherry/browser',
      instance: browserServer.mcpServer
    }

    // Inject skills MCP for all agents — managing Claude skills (search / install
    // / list / remove / init / register) is a generally useful capability and is
    // not coupled to Soul Mode's autonomous-agent semantics.
    const skillsServer = new SkillsServer(session.agent_id)
    options.mcpServers.skills = { type: 'sdk', name: 'skills', instance: skillsServer.mcpServer }
    // Auto-approve via Cherry Studio's own permission gate. The SDK whitelist
    // (`options.allowedTools`) takes glob patterns, but `canUseTool` checks
    // `autoAllowTools` with exact string matching, so we have to add the full
    // tool names there too — otherwise non-Soul agents (which do not run in
    // bypassPermissions mode) get an approval prompt for every call.
    autoAllowTools.add('mcp__skills__skills')
    if (Array.isArray(options.allowedTools) && options.allowedTools.length > 0) {
      if (!options.allowedTools.includes('mcp__skills__*')) {
        options.allowedTools = [...options.allowedTools, 'mcp__skills__*']
      }
    }

    // Inject agent workspace memory MCP for all agents — cross-session FACT.md /
    // JOURNAL.jsonl in the agent's workspace. Distinct from the user-opt-in
    // built-in `memory-server` (knowledge graph). Any agent with a stable
    // workspace benefits from this.
    const workspaceMemoryServer = new WorkspaceMemoryServer(session.agent_id)
    options.mcpServers['agent-memory'] = {
      type: 'sdk',
      name: 'agent-memory',
      instance: workspaceMemoryServer.mcpServer
    }
    autoAllowTools.add('mcp__agent-memory__memory')
    if (Array.isArray(options.allowedTools) && options.allowedTools.length > 0) {
      if (!options.allowedTools.includes('mcp__agent-memory__*')) {
        options.allowedTools = [...options.allowedTools, 'mcp__agent-memory__*']
      }
    }

    if (soulEnabled) {
      // Find the channel that owns this session (if any) for context-aware cron defaults
      const sourceChannelId = await this.resolveSourceChannel(session.agent_id, session.id)
      const clawServer = new ClawServer(session.agent_id, sourceChannelId)
      options.mcpServers.claw = {
        type: 'sdk',
        name: 'claw',
        instance: clawServer.mcpServer
      }

      // Auto-approve claw MCP tools at both layers (see skills/memory above
      // for the SDK-glob vs canUseTool-exact-match rationale). Soul agents
      // typically run in bypassPermissions, so this is defense in depth, but
      // it lets claw also work for any future non-bypass Soul session.
      autoAllowTools.add('mcp__claw__cron')
      autoAllowTools.add('mcp__claw__notify')
      autoAllowTools.add('mcp__claw__config')
      if (Array.isArray(options.allowedTools) && options.allowedTools.length > 0) {
        if (!options.allowedTools.includes('mcp__claw__*')) {
          options.allowedTools = [...options.allowedTools, 'mcp__claw__*']
        }
      }

      logger.debug('Soul Mode: injected claw MCP server', {
        agentId: session.agent_id,
        totalMcpServers: Object.keys(options.mcpServers).length
      })
    }

    // Boss Assistant: inject navigate + diagnose MCP server
    if (isAssistant) {
      const assistantServer = new AssistantServer()
      options.mcpServers.assistant = {
        type: 'sdk',
        name: 'assistant',
        instance: assistantServer.mcpServer
      }

      // Auto-approve assistant MCP tools at both layers (see skills/memory
      // above for the SDK-glob vs canUseTool-exact-match rationale).
      autoAllowTools.add('mcp__assistant__navigate')
      autoAllowTools.add('mcp__assistant__diagnose')
      if (Array.isArray(options.allowedTools) && options.allowedTools.length > 0) {
        if (!options.allowedTools.includes('mcp__assistant__*')) {
          options.allowedTools = [...options.allowedTools, 'mcp__assistant__*']
        }
      } else {
        // When allowed_tools is empty/undefined, set it so assistant MCP tools are auto-approved
        options.allowedTools = ['mcp__assistant__*']
      }

      logger.debug('Boss Assistant: injected assistant MCP server', {
        agentId: session.agent_id,
        totalMcpServers: Object.keys(options.mcpServers).length
      })
    }

    if (lastAgentSessionId && !NO_RESUME_COMMANDS.some((cmd) => promptText.includes(cmd))) {
      options.resume = lastAgentSessionId
      // TODO: use fork session when we support branching sessions
      // options.forkSession = true
    }

    logger.info('Starting Claude Code SDK query', {
      prompt: promptText,
      cwd: options.cwd,
      model: options.model,
      providerRoute,
      permissionMode: options.permissionMode,
      maxTurns: options.maxTurns,
      allowedTools: options.allowedTools,
      resume: options.resume
    })

    const { stream: userInputStream, close: closeUserStream } = await this.createUserMessageStream(
      promptText,
      abortController.signal,
      images
    )

    // Start async processing on the next tick so listeners can subscribe first
    setImmediate(() => {
      this.processSDKQuery(
        userInputStream,
        closeUserStream,
        options,
        aiStream,
        errorChunks,
        session.agent_id,
        session.id
      ).catch((error) => {
        logger.error('Unhandled Claude Code stream error', {
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error)
        })
        aiStream.emit('data', {
          type: 'error',
          error: error instanceof Error ? error : new Error(String(error))
        })
      })
    })

    return aiStream
  }

  private async resolveSourceChannel(agentId: string, sessionId: string): Promise<string | undefined> {
    try {
      const { channelService } = await import('../ChannelService')
      const channels = await channelService.listChannels({ agentId })
      return channels.find((ch) => ch.sessionId === sessionId)?.id
    } catch {
      return undefined
    }
  }

  private async createUserMessageStream(
    initialPrompt: string,
    abortSignal: AbortSignal,
    images?: Array<{ data: string; media_type: string }>
  ) {
    const content = await this.buildMessageContent(initialPrompt, images)
    return createOneShotUserMessageStream(content, abortSignal)
  }

  private async buildMessageContent(
    prompt: string,
    images?: Array<{ data: string; media_type: string }>
  ): Promise<string | ContentBlockParam[]> {
    if (!images || images.length === 0) {
      return prompt
    }

    const blocks: ContentBlockParam[] = [{ type: 'text', text: prompt }]

    const resizedImages = await Promise.all(images.map((img) => this.resizeImageIfNeeded(img.data, img.media_type)))

    for (const resized of resizedImages) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: resized.media_type as Base64ImageSource['media_type'],
          data: resized.data
        }
      })
    }

    return blocks
  }

  /**
   * Resize base64 image if it exceeds the Claude API's dimension limit.
   * Uses sharp which handles JPEG/PNG/WebP/GIF/AVIF/TIFF.
   */
  private async resizeImageIfNeeded(
    base64Data: string,
    mediaType: string
  ): Promise<{ data: string; media_type: string }> {
    try {
      const { default: sharp } = await import('sharp')
      let buffer: Buffer = Buffer.from(base64Data, 'base64')
      const metadata = await sharp(buffer).metadata()

      let width = metadata.width ?? 0
      let height = metadata.height ?? 0

      const needsResize = width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION
      const needsShrink = buffer.length > IMAGE_MAX_BYTES
      const needsConvert = mediaType !== 'image/png'

      if (!needsResize && !needsShrink && !needsConvert) {
        return { data: base64Data, media_type: mediaType }
      }

      // Step 1: Resize if dimensions exceed limit
      if (needsResize) {
        const scale = Math.min(IMAGE_MAX_DIMENSION / width, IMAGE_MAX_DIMENSION / height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
        buffer = await sharp(buffer).resize(width, height, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
        logger.info('Resized oversized image for Claude API', {
          original: `${metadata.width}x${metadata.height}`,
          resized: `${width}x${height}`
        })
      } else if (needsConvert || needsShrink) {
        // Convert to PNG first (may reduce size for some formats)
        buffer = await sharp(buffer).png().toBuffer()
      }

      // Step 2: If still over 5MB, progressively scale down
      let attempt = 0
      while (buffer.length > IMAGE_MAX_BYTES && attempt < 5) {
        attempt++
        const shrinkFactor = 0.7
        width = Math.round(width * shrinkFactor)
        height = Math.round(height * shrinkFactor)
        buffer = await sharp(buffer).resize(width, height, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
        logger.info('Shrinking image to fit 5MB API limit', {
          attempt,
          size: `${(buffer.length / 1024 / 1024).toFixed(1)}MB`,
          dimensions: `${width}x${height}`
        })
      }

      if (buffer.length > IMAGE_MAX_BYTES) {
        logger.warn('Image still exceeds 5MB after shrinking, passing through', {
          size: `${(buffer.length / 1024 / 1024).toFixed(1)}MB`
        })
      }

      return {
        data: buffer.toString('base64'),
        media_type: 'image/png'
      }
    } catch (error) {
      logger.warn('Image resize failed, passing through as-is', {
        error: error instanceof Error ? error.message : String(error)
      })
      return { data: base64Data, media_type: mediaType }
    }
  }

  /**
   * Process SDK query and emit stream events
   */
  private async processSDKQuery(
    promptStream: AsyncIterable<UserInputMessage>,
    closePromptStream: () => void,
    options: Options,
    stream: ClaudeCodeStream,
    errorChunks: string[],
    agentId: string,
    sessionId: string
  ): Promise<void> {
    let messageCount = 0
    let hasCompleted = false
    const startTime = Date.now()
    const streamState = new ClaudeStreamState({ agentSessionId: sessionId })
    let terminalError: Error | undefined
    let timeoutInfo: ClaudeStreamTimeout | undefined
    const sdkAbortController = options.abortController ?? new AbortController()
    options.abortController = sdkAbortController
    const watchdog = createStreamWatchdog({
      abortController: sdkAbortController,
      firstByteTimeoutMs: CLAUDE_FIRST_BYTE_TIMEOUT_MS,
      inactivityTimeoutMs: CLAUDE_INACTIVITY_TIMEOUT_MS,
      onTimeout: (timeout) => {
        timeoutInfo = timeout
        terminalError = new Error(
          `Claude SDK stream ${timeout.phase} timeout after ${Math.round(timeout.timeoutMs / 1000)}s`
        )
        logger.error('Claude SDK stream watchdog timeout', {
          sessionId,
          phase: timeout.phase,
          timeoutMs: timeout.timeoutMs,
          messageCount
        })
      }
    })

    const emitTerminalError = (error: Error, duration: number, stderr?: string[]) => {
      if (hasCompleted) {
        return
      }
      hasCompleted = true
      logger.error('SDK query failed', {
        duration,
        error: { name: error.name, message: error.message },
        messageCount,
        timeout: timeoutInfo,
        stderr
      })
      stream.emit('data', {
        type: 'error',
        error
      })
    }

    try {
      for await (const message of query({ prompt: promptStream, options })) {
        if (hasCompleted) break

        watchdog.markMessageReceived()
        messageCount++

        if (messageCount > CLAUDE_MAX_SDK_MESSAGES) {
          terminalError = new Error(`Claude SDK stream exceeded ${CLAUDE_MAX_SDK_MESSAGES} messages`)
          sdkAbortController.abort(terminalError)
          throw terminalError
        }

        // Handle init message - merge builtin and SDK slash_commands
        if (message.type === 'system' && message.subtype === 'init') {
          if (message.session_id) {
            stream.sdkSessionId = message.session_id
            logger.info('Captured SDK session_id from init message', {
              sdkSessionId: message.session_id,
              sessionId
            })
          }

          const sdkSlashCommands = message.slash_commands || []
          logger.info('Received init message with slash commands', {
            sessionId,
            commands: sdkSlashCommands
          })

          try {
            // Get builtin + local slash commands from BaseService
            const existingCommands = await sessionService.listSlashCommands('claude-code', agentId)

            // Convert SDK slash_commands (string[]) to SlashCommand[] format
            // Ensure all commands start with '/'
            const sdkCommands = sdkSlashCommands.map((cmd) => {
              const normalizedCmd = cmd.startsWith('/') ? cmd : `/${cmd}`
              return {
                command: normalizedCmd,
                description: undefined
              }
            })

            // Merge: existing commands (builtin + local) + SDK commands, deduplicate by command name
            const commandMap = new Map<string, { command: string; description?: string }>()

            for (const cmd of existingCommands) {
              commandMap.set(cmd.command, cmd)
            }

            for (const cmd of sdkCommands) {
              if (!commandMap.has(cmd.command)) {
                commandMap.set(cmd.command, cmd)
              }
            }

            const mergedCommands = Array.from(commandMap.values())

            // Update session in database
            await sessionService.updateSession(agentId, sessionId, {
              slash_commands: mergedCommands
            })

            logger.info('Updated session with merged slash commands', {
              sessionId,
              existingCount: existingCommands.length,
              sdkCount: sdkCommands.length,
              totalCount: mergedCommands.length
            })
          } catch (error) {
            logger.error('Failed to update session slash_commands', {
              sessionId,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }

        const chunks = transformSDKMessageToStreamParts(message, streamState)
        for (const chunk of chunks) {
          stream.emit('data', {
            type: 'chunk',
            chunk
          })

          // Close prompt stream when SDK signals completion or error
          if (chunk.type === 'finish' || chunk.type === 'error') {
            logger.info('Closing prompt stream as SDK signaled completion', {
              chunkType: chunk.type,
              reason: chunk.type === 'finish' ? 'finished' : 'error_occurred'
            })
            closePromptStream()
            logger.info('Prompt stream closed successfully')
            if (chunk.type === 'error') {
              const errorMessage =
                typeof chunk.error === 'object' && chunk.error && 'message' in chunk.error
                  ? String(chunk.error.message)
                  : 'Claude SDK stream returned an error'
              terminalError = new Error(errorMessage)
              throw terminalError
            }
          }
        }
      }

      const duration = Date.now() - startTime

      if (terminalError) {
        emitTerminalError(terminalError, duration, errorChunks)
        return
      }

      if (hasCompleted) {
        return
      }
      hasCompleted = true
      logger.debug('SDK query completed successfully', {
        duration,
        messageCount
      })

      stream.emit('data', {
        type: 'complete'
      })
    } catch (error) {
      if (hasCompleted) return

      const duration = Date.now() - startTime
      const errorObj = error as any
      if (terminalError) {
        emitTerminalError(terminalError, duration, errorChunks)
        return
      }

      const isAborted =
        errorObj?.name === 'AbortError' || errorObj?.message?.includes('aborted') || sdkAbortController.signal.aborted

      if (isAborted) {
        hasCompleted = true
        logger.info('SDK query aborted by client disconnect', { duration })
        stream.emit('data', {
          type: 'cancelled',
          error: new Error('Request aborted by client')
        })
        return
      }

      errorChunks.push(errorObj instanceof Error ? errorObj.message : String(errorObj))
      const errorMessage = errorChunks.join('\n\n')
      emitTerminalError(new Error(errorMessage), duration, errorChunks)
    } finally {
      watchdog.cleanup()
      closePromptStream()
    }
  }
}

/**
 * Build a lightweight environment snapshot (~200 tokens) for Boss Assistant.
 * Injected into system prompt so the agent knows the user's setup immediately.
 */
async function buildAssistantContext(): Promise<string> {
  const appVersion = app.getVersion()
  const platform = `${os.platform()} ${os.release()}`
  const language = configManager.getLanguage()
  const theme = configManager.getTheme()
  const proxy = configManager.get<string>('proxy', '')

  // Provider summary (no apiKey exposed)
  const providers = configManager.get<Record<string, unknown>[]>('providers', [])
  const configuredProviders = providers
    .filter((p) => p.apiKey || p.enabled)
    .map((p) => `${p.name || p.id}(${(p.models as unknown[])?.length || 0} models)`)

  // MCP summary
  const mcpServers = configManager.get<Record<string, unknown>[]>('mcpServers', [])
  const activeMcp = mcpServers.filter((s) => s.isActive)

  // Network probe (parallel, 2s timeout each)
  const probeResults = await Promise.allSettled([
    probeHost('github.com'),
    probeHost('google.com'),
    probeHost('the-boss.know-me.tools')
  ])
  const networkLines = probeResults.map((r) => {
    const v = r.status === 'fulfilled' ? r.value : { host: '?', ok: false, ms: 0 }
    return `- ${v.host}: ${v.ok ? `reachable (${v.ms}ms)` : 'unreachable'}`
  })

  return [
    '## Current Environment',
    `- App: The Boss v${appVersion}`,
    `- OS: ${platform}`,
    `- Language: ${language}, Theme: ${theme}`,
    proxy ? `- Proxy: ${proxy}` : '- Proxy: none',
    `- Providers (${configuredProviders.length}): ${configuredProviders.join(', ') || 'none configured'}`,
    `- MCP Servers: ${activeMcp.length} active / ${mcpServers.length} total`,
    '',
    '## Network',
    ...networkLines
  ].join('\n')
}

async function probeHost(host: string): Promise<{ host: string; ok: boolean; ms: number }> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    await fetch(`https://${host}`, {
      method: 'HEAD',
      signal: controller.signal
    })
    clearTimeout(timeout)
    return { host, ok: true, ms: Date.now() - start }
  } catch {
    return { host, ok: false, ms: Date.now() - start }
  }
}

export default ClaudeCodeService
