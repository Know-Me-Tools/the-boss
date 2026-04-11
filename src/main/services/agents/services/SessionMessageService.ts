import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import knowledgeService from '@main/services/KnowledgeService'
import { buildSkillStreamParts } from '@main/services/skills/buildSkillStreamParts'
import type { ContextManagementStreamPayload } from '@shared/contextManagementStream'
import type {
  AgentEntity,
  AgentPersistedMessage,
  AgentSessionMessageEntity,
  ContextStrategyConfig,
  CreateSessionMessageRequest,
  ExternalToolResult,
  GetAgentSessionResponse,
  KnowledgeBase,
  KnowledgeBaseParams,
  KnowledgeReference,
  KnowledgeSearchResult,
  ListOptions,
  SkillGlobalConfig
} from '@types'
import { DEFAULT_SKILL_CONFIG, resolveSkillConfig } from '@types'
import type { TextStreamPart } from 'ai'
import { and, desc, eq, not } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { agentsTable, sessionMessagesTable, sessionsTable } from '../database/schema'
import { agentMessageRepository } from '../database/sessionMessageRepository'
import type { AgentStream, AgentStreamEvent } from '../interfaces/AgentStreamInterface'
import {
  extractTotalTokensFromFinishPart,
  getAgentSessionLastTotalTokens,
  getEffectiveAgentContextStrategy,
  setAgentSessionLastTotalTokens,
  shouldRunSdkCompactBeforeTurn
} from './agentContextStrategy'
import ClaudeCodeService from './claudecode'
import { sessionService } from './SessionService'

const claudeCodeService = new ClaudeCodeService()

const logger = loggerService.withContext('SessionMessageService')
const DEFAULT_KNOWLEDGE_DOCUMENT_COUNT = 6
const DEFAULT_KNOWLEDGE_THRESHOLD = 0
const KNOWLEDGE_REFERENCE_PROMPT = `Please answer the question based on the reference materials

## Citation Rules:
- Please cite the context at the end of sentences when appropriate.
- Please use the format of citation number [number] to reference the context in corresponding parts of your answer.
- If a sentence comes from multiple contexts, please list all relevant citation numbers, e.g., [1][2]. Remember not to group citations at the end but list them in the corresponding parts of your answer.
- If all reference content is not relevant to the user's question, please answer based on your knowledge.

## My question is:

{question}

## Reference Materials:

{references}

Please respond in the same language as the user's question.
`

type KnowledgeBaseRuntimeConfig = Record<
  string,
  {
    embedApiClient: KnowledgeBaseParams['embedApiClient']
    rerankApiClient?: KnowledgeBaseParams['rerankApiClient']
  }
>

type PersistedAgentKnowledgeEntity = AgentEntity & {
  knowledge_base_configs?: KnowledgeBaseRuntimeConfig
}

type PersistedSessionKnowledgeEntity = GetAgentSessionResponse & {
  knowledge_base_configs?: KnowledgeBaseRuntimeConfig
}

type SessionStreamResult = {
  stream: ReadableStream<TextStreamPart<Record<string, any>>>
  completion: Promise<{
    userMessage?: AgentSessionMessageEntity
    assistantMessage?: AgentSessionMessageEntity
  }>
}

export type CreateMessageOptions = {
  /** When true, persist user+assistant messages to DB on stream complete. Use for headless callers (channels, scheduler) where no UI handles persistence. */
  persist?: boolean
  /** Optional display-safe user content for persistence. When set, this is stored instead of req.content (which may contain security wrappers not meant for display). */
  displayContent?: string
  /** Images to persist in the user message for UI display (not sent to AI model). */
  images?: Array<{ data: string; media_type: string }>
}

// Ensure errors emitted through SSE are serializable
function serializeError(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack
    }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  return {
    message: 'Unknown error'
  }
}

class TextStreamAccumulator {
  private textBuffer = ''
  private totalText = ''
  private readonly toolCalls = new Map<string, { toolName?: string; input?: unknown }>()
  private readonly toolResults = new Map<string, unknown>()

  add(part: TextStreamPart<Record<string, any>>): void {
    switch (part.type) {
      case 'text-start':
        this.textBuffer = ''
        break
      case 'text-delta':
        if (part.text) {
          this.textBuffer = part.text
        }
        break
      case 'text-end': {
        const blockText = (part.providerMetadata?.text?.value as string | undefined) ?? this.textBuffer
        if (blockText) {
          this.totalText += blockText
        }
        this.textBuffer = ''
        break
      }
      case 'tool-call':
        if (part.toolCallId) {
          const legacyPart = part as typeof part & {
            args?: unknown
            providerMetadata?: { raw?: { input?: unknown } }
          }
          this.toolCalls.set(part.toolCallId, {
            toolName: part.toolName,
            input: part.input ?? legacyPart.args ?? legacyPart.providerMetadata?.raw?.input
          })
        }
        break
      case 'tool-result':
        if (part.toolCallId) {
          const legacyPart = part as typeof part & {
            result?: unknown
            providerMetadata?: { raw?: unknown }
          }
          this.toolResults.set(part.toolCallId, part.output ?? legacyPart.result ?? legacyPart.providerMetadata?.raw)
        }
        break
      default:
        break
    }
  }

  getText(): string {
    return (this.totalText + this.textBuffer).replace(/\n+$/, '')
  }
}

export class SessionMessageService extends BaseService {
  private static instance: SessionMessageService | null = null

  static getInstance(): SessionMessageService {
    if (!SessionMessageService.instance) {
      SessionMessageService.instance = new SessionMessageService()
    }
    return SessionMessageService.instance
  }

  async sessionMessageExists(id: number): Promise<boolean> {
    const database = await this.getDatabase()
    const result = await database
      .select({ id: sessionMessagesTable.id })
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.id, id))
      .limit(1)

    return result.length > 0
  }

  async listSessionMessages(
    sessionId: string,
    options: ListOptions = {}
  ): Promise<{ messages: AgentSessionMessageEntity[] }> {
    // Get messages with pagination
    const database = await this.getDatabase()
    const baseQuery = database
      .select()
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.session_id, sessionId))
      .orderBy(sessionMessagesTable.created_at)

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const messages = result.map((row) => this.deserializeSessionMessage(row))

    return { messages }
  }

  async deleteSessionMessage(sessionId: string, messageId: number): Promise<boolean> {
    const database = await this.getDatabase()
    const result = await database
      .delete(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.session_id, sessionId)))

    return result.rowsAffected > 0
  }

  async createSessionMessage(
    session: GetAgentSessionResponse,
    messageData: CreateSessionMessageRequest,
    abortController: AbortController,
    options?: CreateMessageOptions
  ): Promise<SessionStreamResult> {
    return await this.startSessionMessageStream(session, messageData, abortController, options)
  }

  private async getPersistedSession(sessionId: string): Promise<PersistedSessionKnowledgeEntity | null> {
    const database = await this.getDatabase()
    const result = await database.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1)
    if (!result[0]) {
      return null
    }
    return this.deserializeJsonFields(result[0]) as PersistedSessionKnowledgeEntity
  }

  private async getPersistedAgent(agentId: string): Promise<PersistedAgentKnowledgeEntity | null> {
    const database = await this.getDatabase()
    const result = await database.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1)
    if (!result[0]) {
      return null
    }
    return this.deserializeJsonFields(result[0]) as PersistedAgentKnowledgeEntity
  }

  private resolveEffectiveKnowledgeConfig(
    session: PersistedSessionKnowledgeEntity,
    agent: PersistedAgentKnowledgeEntity | null
  ): {
    knowledgeBases: KnowledgeBase[]
    knowledgeRecognition: 'off' | 'on'
    runtimeConfigs?: KnowledgeBaseRuntimeConfig
  } {
    const knowledgeBases = Array.isArray(session.knowledge_bases)
      ? session.knowledge_bases
      : (agent?.knowledge_bases ?? [])

    return {
      knowledgeBases,
      knowledgeRecognition: session.knowledgeRecognition ?? agent?.knowledgeRecognition ?? 'off',
      runtimeConfigs: session.knowledge_base_configs ?? agent?.knowledge_base_configs
    }
  }

  private async searchKnowledgeReferences(
    query: string,
    knowledgeBases: KnowledgeBase[],
    runtimeConfigs?: KnowledgeBaseRuntimeConfig
  ): Promise<KnowledgeReference[]> {
    if (!runtimeConfigs || !knowledgeBases.length) {
      return []
    }

    const references: KnowledgeReference[] = []

    for (const base of knowledgeBases) {
      const runtimeConfig = runtimeConfigs[base.id]
      if (!runtimeConfig?.embedApiClient) {
        logger.warn('Skipping agent knowledge search due to missing runtime config', {
          baseId: base.id,
          baseName: base.name
        })
        continue
      }

      try {
        const baseParams: KnowledgeBaseParams = {
          id: base.id,
          dimensions: base.dimensions,
          chunkSize: base.chunkSize,
          chunkOverlap: base.chunkOverlap,
          documentCount: base.documentCount,
          preprocessProvider: base.preprocessProvider,
          embedApiClient: runtimeConfig.embedApiClient,
          rerankApiClient: runtimeConfig.rerankApiClient
        }

        let results: KnowledgeSearchResult[] = await knowledgeService.search({} as Electron.IpcMainInvokeEvent, {
          search: query,
          base: baseParams
        })

        results = results.filter((item) => item.score >= (base.threshold ?? DEFAULT_KNOWLEDGE_THRESHOLD))

        if (runtimeConfig.rerankApiClient && results.length > 0) {
          results = await knowledgeService.rerank({} as Electron.IpcMainInvokeEvent, {
            search: query,
            base: baseParams,
            results
          })
        }

        const limitedResults = results.slice(0, base.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT)
        references.push(
          ...limitedResults.map((item) => ({
            id: 0,
            content: item.pageContent,
            sourceUrl: typeof item.metadata?.source === 'string' ? item.metadata.source : base.name,
            metadata: item.metadata,
            type: (item.metadata?.type as KnowledgeReference['type']) || 'file'
          }))
        )
      } catch (error) {
        logger.warn('Agent knowledge search failed for base; continuing without it', {
          baseId: base.id,
          baseName: base.name,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return references.map((reference, index) => ({
      ...reference,
      id: index + 1
    }))
  }

  private async prepareKnowledgeAugmentation(
    prompt: string,
    session: PersistedSessionKnowledgeEntity,
    agent: PersistedAgentKnowledgeEntity | null
  ): Promise<{
    prompt: string
    externalToolResult?: ExternalToolResult
  }> {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      return { prompt }
    }

    const { knowledgeBases, knowledgeRecognition, runtimeConfigs } = this.resolveEffectiveKnowledgeConfig(
      session,
      agent
    )
    if (knowledgeRecognition !== 'on' || knowledgeBases.length === 0) {
      return { prompt }
    }

    const knowledgeReferences = await this.searchKnowledgeReferences(trimmedPrompt, knowledgeBases, runtimeConfigs)
    if (knowledgeReferences.length === 0) {
      return { prompt }
    }

    return {
      prompt: KNOWLEDGE_REFERENCE_PROMPT.replace('{question}', prompt).replace(
        '{references}',
        JSON.stringify(knowledgeReferences, null, 2)
      ),
      externalToolResult: {
        knowledge: knowledgeReferences
      }
    }
  }

  private async loadGlobalAgentContextSettings(): Promise<{
    strategy: ContextStrategyConfig
    summarizationModelId: string | null
  }> {
    try {
      const { reduxService } = await import('@main/services/ReduxService')
      const settings = await reduxService.select('state.settings')
      return {
        strategy: settings?.agentContextStrategy ?? { type: 'none' },
        summarizationModelId:
          settings?.agentContextSummarizationModelId ?? settings?.contextSummarizationModelId ?? null
      }
    } catch {
      return { strategy: { type: 'none' }, summarizationModelId: null }
    }
  }

  private async loadGlobalSkillConfig(): Promise<SkillGlobalConfig> {
    try {
      const { reduxService } = await import('@main/services/ReduxService')
      const globalSkillConfig = await reduxService.select('state.skillConfig.global')
      return resolveSkillConfig(globalSkillConfig ?? DEFAULT_SKILL_CONFIG)
    } catch {
      return resolveSkillConfig(DEFAULT_SKILL_CONFIG)
    }
  }

  /**
   * Consume a Claude Code stream for a single-shot operation (e.g. `/compact`) without exposing SSE.
   */
  private async drainClaudeStreamForCompaction(stream: AgentStream, session: GetAgentSessionResponse): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onData = (event: AgentStreamEvent) => {
        if (event.type === 'chunk' && event.chunk) {
          const tokens = extractTotalTokensFromFinishPart(event.chunk as TextStreamPart<Record<string, any>>)
          if (tokens !== undefined) {
            setAgentSessionLastTotalTokens(session.id, tokens)
            void sessionService.persistSessionLastTotalTokens(session.agent_id, session.id, tokens).catch((err) =>
              logger.warn('Failed to persist session last_total_tokens after /compact', {
                sessionId: session.id,
                error: err instanceof Error ? err.message : String(err)
              })
            )
          }
        }
        if (event.type === 'error') {
          stream.removeListener('data', onData)
          reject(event.error ?? new Error('Compaction stream error'))
        }
        if (event.type === 'complete' || event.type === 'cancelled') {
          stream.removeListener('data', onData)
          resolve()
        }
      }
      stream.on('data', onData)
    })
    stream.removeAllListeners()
  }

  private async startSessionMessageStream(
    session: GetAgentSessionResponse,
    req: CreateSessionMessageRequest,
    abortController: AbortController,
    options?: CreateMessageOptions
  ): Promise<SessionStreamResult> {
    const agentSessionId = await this.getLastAgentSessionId(session.id)
    logger.debug('Session Message stream message data:', { message: req, session_id: agentSessionId })

    await sessionService.ensureLastTotalTokensInMemory(session.agent_id, session.id)

    const persistedSession =
      (await this.getPersistedSession(session.id)) ?? (session as PersistedSessionKnowledgeEntity)
    const persistedAgent = await this.getPersistedAgent(session.agent_id)

    const globalAgent = await this.loadGlobalAgentContextSettings()
    const effectiveContext = getEffectiveAgentContextStrategy({
      globalStrategy: globalAgent.strategy,
      globalSummarizationModelId: globalAgent.summarizationModelId,
      agentConfiguration: persistedAgent?.configuration ?? null,
      sessionConfiguration: persistedSession.configuration ?? null
    })

    logger.debug('Effective agent context strategy', {
      sessionId: session.id,
      strategyType: effectiveContext.type
    })

    let agentContextNotice: ContextManagementStreamPayload | undefined
    let skillStreamParts: Array<TextStreamPart<Record<string, any>>> = []
    const knowledgeAugmentation = await this.prepareKnowledgeAugmentation(req.content, persistedSession, persistedAgent)

    if (
      shouldRunSdkCompactBeforeTurn({
        appSessionId: session.id,
        sdkSessionIdForResume: agentSessionId,
        userPrompt: req.content,
        config: effectiveContext
      })
    ) {
      const tokensBeforeCompact = getAgentSessionLastTotalTokens(session.id)
      try {
        const compactAbort = new AbortController()
        const compactStream = await claudeCodeService.invoke(
          '/compact',
          session,
          compactAbort,
          agentSessionId,
          {
            effort: req.effort,
            thinking: req.thinking
          },
          undefined
        )
        await this.drainClaudeStreamForCompaction(compactStream, session)
        const tokensAfterCompact = getAgentSessionLastTotalTokens(session.id)
        agentContextNotice = {
          surface: 'agent',
          strategyType: effectiveContext.type,
          tokensBefore: tokensBeforeCompact,
          tokensAfter: tokensAfterCompact,
          alterationSummary: `SDK /compact ran automatically before your message (policy: ${effectiveContext.type}).`,
          trigger: 'sdk_compact_pre_turn'
        }
        if (tokensBeforeCompact !== undefined && tokensAfterCompact !== undefined) {
          agentContextNotice.tokensSaved = Math.max(0, tokensBeforeCompact - tokensAfterCompact)
        }
        logger.info('Agent context: completed pre-turn SDK /compact', { sessionId: session.id })
      } catch (err) {
        logger.warn('Agent context: pre-turn /compact failed; continuing with user message', {
          sessionId: session.id,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }

    try {
      const globalSkillConfig = await this.loadGlobalSkillConfig()
      const effectiveSkillConfig = resolveSkillConfig(
        globalSkillConfig,
        persistedAgent?.configuration?.skill_config,
        persistedSession.configuration?.skill_config
      )

      if (knowledgeAugmentation.prompt.trim()) {
        skillStreamParts = await buildSkillStreamParts({
          prompt: knowledgeAugmentation.prompt,
          config: effectiveSkillConfig,
          activeModel: persistedSession.model || persistedAgent?.model
        })
      }
    } catch (error) {
      logger.warn('Failed to prepare backend skill stream parts; continuing without skill metadata', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    const claudeStream = await claudeCodeService.invoke(
      knowledgeAugmentation.prompt,
      persistedSession,
      abortController,
      agentSessionId,
      {
        effort: req.effort,
        thinking: req.thinking
      },
      undefined
    )
    const accumulator = new TextStreamAccumulator()

    let resolveCompletion!: (value: {
      userMessage?: AgentSessionMessageEntity
      assistantMessage?: AgentSessionMessageEntity
    }) => void
    let rejectCompletion!: (reason?: unknown) => void

    const completion = new Promise<{
      userMessage?: AgentSessionMessageEntity
      assistantMessage?: AgentSessionMessageEntity
    }>((resolve, reject) => {
      resolveCompletion = resolve
      rejectCompletion = reject
    })

    let finished = false

    const cleanup = () => {
      if (finished) return
      finished = true
      claudeStream.removeAllListeners()
    }

    const stream = new ReadableStream<TextStreamPart<Record<string, any>>>({
      start: (controller) => {
        if (knowledgeAugmentation.externalToolResult) {
          controller.enqueue({
            type: 'data-external-tool-in-progress'
          } as unknown as TextStreamPart<Record<string, any>>)
          controller.enqueue({
            type: 'data-external-tool-complete',
            data: knowledgeAugmentation.externalToolResult
          } as unknown as TextStreamPart<Record<string, any>>)
        }
        if (agentContextNotice) {
          controller.enqueue({
            type: 'data-context-management',
            data: agentContextNotice
          } as unknown as TextStreamPart<Record<string, any>>)
        }
        for (const part of skillStreamParts) {
          controller.enqueue(part)
        }
        claudeStream.on('data', async (event: AgentStreamEvent) => {
          if (finished) return
          try {
            switch (event.type) {
              case 'chunk': {
                const chunk = event.chunk as TextStreamPart<Record<string, any>> | undefined
                if (!chunk) {
                  logger.warn('Received agent chunk event without chunk payload')
                  return
                }

                if (chunk.type === 'finish') {
                  const tokens = extractTotalTokensFromFinishPart(chunk as TextStreamPart<Record<string, any>>)
                  if (tokens !== undefined) {
                    setAgentSessionLastTotalTokens(session.id, tokens)
                    void sessionService
                      .persistSessionLastTotalTokens(session.agent_id, session.id, tokens)
                      .catch((err) =>
                        logger.warn('Failed to persist session last_total_tokens', {
                          sessionId: session.id,
                          error: err instanceof Error ? err.message : String(err)
                        })
                      )
                  }
                }

                accumulator.add(chunk)
                controller.enqueue(chunk)
                break
              }

              case 'error': {
                const stderrMessage = (event as any)?.data?.stderr as string | undefined
                const underlyingError = event.error ?? (stderrMessage ? new Error(stderrMessage) : undefined)
                cleanup()
                const streamError = underlyingError ?? new Error('Stream error')
                controller.error(streamError)
                rejectCompletion(serializeError(streamError))
                break
              }

              case 'complete': {
                cleanup()
                controller.close()
                if (options?.persist) {
                  // Read SDK session_id from the stream object (set by ClaudeCodeService on init)
                  const resolvedSessionId = claudeStream.sdkSessionId || agentSessionId
                  logger.debug('Persisting headless exchange with agent session ID', {
                    sdkSessionId: claudeStream.sdkSessionId,
                    fallback: agentSessionId,
                    resolved: resolvedSessionId
                  })
                  this.persistHeadlessExchange(
                    persistedSession,
                    options?.displayContent ?? req.content,
                    accumulator.getText(),
                    resolvedSessionId,
                    options?.images,
                    knowledgeAugmentation.externalToolResult
                  )
                    .then(resolveCompletion)
                    .catch((err) => {
                      logger.error('Failed to persist headless exchange', err as Error)
                      resolveCompletion({})
                    })
                } else {
                  resolveCompletion({})
                }
                break
              }

              case 'cancelled': {
                cleanup()
                controller.close()
                if (options?.persist) {
                  const resolvedSessionId = claudeStream.sdkSessionId || agentSessionId
                  const partialText = accumulator.getText()
                  if (partialText) {
                    this.persistHeadlessExchange(
                      persistedSession,
                      options?.displayContent ?? req.content,
                      partialText,
                      resolvedSessionId,
                      options?.images,
                      knowledgeAugmentation.externalToolResult
                    )
                      .then(resolveCompletion)
                      .catch((err) => {
                        logger.error('Failed to persist cancelled exchange', err as Error)
                        resolveCompletion({})
                      })
                  } else {
                    resolveCompletion({})
                  }
                } else {
                  resolveCompletion({})
                }
                break
              }

              default:
                logger.warn('Unknown event type from Claude Code service:', {
                  type: event.type
                })
                break
            }
          } catch (error) {
            cleanup()
            controller.error(error)
            rejectCompletion(serializeError(error))
          }
        })
      },
      cancel: (reason) => {
        cleanup()
        abortController.abort(typeof reason === 'string' ? reason : 'stream cancelled')
        resolveCompletion({})
      }
    })

    return { stream, completion }
  }

  /**
   * Persist user + assistant messages for headless callers (channels, scheduler)
   * that have no UI to handle persistence via IPC.
   */
  private async persistHeadlessExchange(
    session: GetAgentSessionResponse,
    userContent: string,
    assistantContent: string,
    agentSessionId: string,
    images?: Array<{ data: string; media_type: string }>,
    externalToolResult?: ExternalToolResult
  ): Promise<{ userMessage?: AgentSessionMessageEntity; assistantMessage?: AgentSessionMessageEntity }> {
    const now = new Date().toISOString()
    const userMsgId = randomUUID()
    const assistantMsgId = randomUUID()
    const userBlockId = randomUUID()
    const assistantBlockId = randomUUID()
    const citationBlockId = externalToolResult ? randomUUID() : null
    const topicId = `agent-session:${session.id}`

    // Build image blocks for user message
    const imageBlocks: Array<{
      id: string
      messageId: string
      type: string
      createdAt: string
      status: string
      url: string
    }> = []
    if (images && images.length > 0) {
      for (const img of images) {
        imageBlocks.push({
          id: randomUUID(),
          messageId: userMsgId,
          type: 'image',
          createdAt: now,
          status: 'success',
          url: `data:${img.media_type};base64,${img.data}`
        })
      }
    }

    const userPayload = {
      message: {
        id: userMsgId,
        role: 'user' as const,
        assistantId: session.agent_id,
        topicId,
        createdAt: now,
        status: 'success',
        blocks: [userBlockId, ...imageBlocks.map((b) => b.id)]
      },
      blocks: [
        {
          id: userBlockId,
          messageId: userMsgId,
          type: 'main_text',
          createdAt: now,
          status: 'success',
          content: userContent
        },
        ...imageBlocks
      ]
    } as AgentPersistedMessage

    const assistantPayload = {
      message: {
        id: assistantMsgId,
        role: 'assistant' as const,
        assistantId: session.agent_id,
        topicId,
        createdAt: now,
        status: 'success',
        blocks: [assistantBlockId, ...(citationBlockId ? [citationBlockId] : [])],
        modelId: session.model
      },
      blocks: [
        {
          id: assistantBlockId,
          messageId: assistantMsgId,
          type: 'main_text',
          createdAt: now,
          status: 'success',
          content: assistantContent,
          citationReferences: citationBlockId ? [{ citationBlockId }] : undefined
        },
        ...(citationBlockId
          ? [
              {
                id: citationBlockId,
                messageId: assistantMsgId,
                type: 'citation',
                createdAt: now,
                status: 'success',
                response: externalToolResult?.webSearch,
                knowledge: externalToolResult?.knowledge,
                memories: externalToolResult?.memories
              }
            ]
          : [])
      ]
    } as AgentPersistedMessage

    const result = await agentMessageRepository.persistExchange({
      sessionId: session.id,
      agentSessionId,
      user: { payload: userPayload, createdAt: now },
      assistant: { payload: assistantPayload, createdAt: now }
    })

    logger.info('Persisted headless exchange', {
      sessionId: session.id,
      userMessageId: userMsgId,
      assistantMessageId: assistantMsgId
    })

    return result
  }

  private async getLastAgentSessionId(sessionId: string): Promise<string> {
    try {
      const database = await this.getDatabase()
      const result = await database
        .select({ agent_session_id: sessionMessagesTable.agent_session_id })
        .from(sessionMessagesTable)
        .where(and(eq(sessionMessagesTable.session_id, sessionId), not(eq(sessionMessagesTable.agent_session_id, ''))))
        .orderBy(desc(sessionMessagesTable.created_at))
        .limit(1)

      logger.silly('Last agent session ID result:', { agentSessionId: result[0]?.agent_session_id, sessionId })
      return result[0]?.agent_session_id || ''
    } catch (error) {
      logger.error('Failed to get last agent session ID', {
        sessionId,
        error
      })
      return ''
    }
  }

  private deserializeSessionMessage(data: any): AgentSessionMessageEntity {
    if (!data) return data

    const deserialized = { ...data }

    // Parse content JSON
    if (deserialized.content && typeof deserialized.content === 'string') {
      try {
        deserialized.content = JSON.parse(deserialized.content)
      } catch (error) {
        logger.warn(`Failed to parse content JSON:`, error as Error)
      }
    }

    // Parse metadata JSON
    if (deserialized.metadata && typeof deserialized.metadata === 'string') {
      try {
        deserialized.metadata = JSON.parse(deserialized.metadata)
      } catch (error) {
        logger.warn(`Failed to parse metadata JSON:`, error as Error)
      }
    }

    return deserialized
  }
}

export const sessionMessageService = SessionMessageService.getInstance()
