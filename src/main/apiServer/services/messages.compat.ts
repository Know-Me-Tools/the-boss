import crypto from 'node:crypto'

import type { MessageCreateParams } from '@anthropic-ai/sdk/resources'
import { getCompatExecutor } from '@main/aiCore/provider/runtimeConfig'
import { loggerService } from '@main/services/LoggerService'
import type { Model, Provider } from '@types'
import { jsonSchema, type ModelMessage, tool, type ToolSet } from 'ai'
import type { JSONSchema7 } from 'json-schema'

const logger = loggerService.withContext('CompatMessagesService')

type AnthropicTextBlock = {
  type: 'text'
  text: string
}

type AnthropicImageBlock = {
  type: 'image'
  source: {
    type: 'base64'
    data: string
    media_type: string
  }
}

type AnthropicToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

type AnthropicToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string | Array<AnthropicTextBlock | AnthropicImageBlock>
  is_error?: boolean
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock

type AnthropicMessageResponse = {
  id: string
  type: 'message'
  role: 'assistant'
  content: Array<AnthropicTextBlock | AnthropicToolUseBlock>
  model: string
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
  stop_sequence: string | null
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

type CompatExecution = {
  executor: Awaited<ReturnType<typeof getCompatExecutor>>
  model: Model
  params: Record<string, unknown>
}

type AnthropicToolChoice = NonNullable<MessageCreateParams['tool_choice']>

function normalizeSystemPrompt(system: MessageCreateParams['system']): string | undefined {
  if (!system) {
    return undefined
  }

  if (typeof system === 'string') {
    return system
  }

  if (!Array.isArray(system)) {
    return undefined
  }

  return system
    .map((entry) => ('text' in entry && typeof entry.text === 'string' ? entry.text : ''))
    .filter(Boolean)
    .join('\n\n')
}

function convertToolChoice(toolChoice: AnthropicToolChoice | undefined) {
  if (!toolChoice) {
    return undefined
  }

  switch (toolChoice.type) {
    case 'auto':
      return 'auto'
    case 'any':
      return 'required'
    case 'tool':
      return {
        type: 'tool' as const,
        toolName: toolChoice.name
      }
    default:
      return undefined
  }
}

function convertToolResultContent(content: AnthropicToolResultBlock['content'], isError?: boolean): any {
  if (typeof content === 'string') {
    return {
      type: isError ? 'error-text' : 'text',
      value: content
    }
  }

  return {
    type: 'content',
    value: content.map((part) => {
      if (part.type === 'image') {
        return {
          type: 'image-data' as const,
          data: part.source.data,
          mediaType: part.source.media_type
        }
      }

      return {
        type: 'text' as const,
        text: part.text
      }
    })
  }
}

function convertAnthropicMessages(messages: MessageCreateParams['messages']): ModelMessage[] {
  const converted: ModelMessage[] = []
  const toolNames = new Map<string, string>()

  for (const message of messages) {
    if (typeof message.content === 'string') {
      converted.push({
        role: message.role,
        content: message.content
      })
      continue
    }

    const blocks = message.content as AnthropicContentBlock[]

    if (message.role === 'assistant') {
      const assistantContent: any[] = []
      for (const block of blocks) {
        if (block.type === 'text') {
          assistantContent.push({ type: 'text' as const, text: block.text })
          continue
        }

        if (block.type === 'tool_use') {
          toolNames.set(block.id, block.name)
          assistantContent.push({
            type: 'tool-call' as const,
            toolCallId: block.id,
            toolName: block.name,
            input: block.input,
            providerExecuted: true
          })
        }
      }

      if (assistantContent.length > 0) {
        converted.push({
          role: 'assistant',
          content: assistantContent as any
        })
      }
      continue
    }

    let userContent: any[] = []
    let toolContent: any[] = []

    const flushUserContent = () => {
      if (userContent.length === 0) {
        return
      }

      converted.push({
        role: 'user',
        content:
          userContent.length === 1 && userContent[0].type === 'text'
            ? userContent[0].text
            : (userContent.map((part) =>
                part.type === 'text'
                  ? part
                  : {
                      type: 'image' as const,
                      image: part.image,
                      mediaType: part.mediaType
                    }
              ) as any)
      })
      userContent = []
    }

    const flushToolContent = () => {
      if (toolContent.length === 0) {
        return
      }

      converted.push({
        role: 'tool',
        content: toolContent as any
      })
      toolContent = []
    }

    for (const block of blocks) {
      if (block.type === 'tool_result') {
        flushUserContent()
        toolContent.push({
          type: 'tool-result',
          toolCallId: block.tool_use_id,
          toolName: toolNames.get(block.tool_use_id) ?? 'unknown',
          output: convertToolResultContent(block.content, block.is_error)
        })
        continue
      }

      flushToolContent()

      if (block.type === 'text') {
        userContent.push({
          type: 'text',
          text: block.text
        })
        continue
      }

      if (block.type === 'image') {
        userContent.push({
          type: 'image',
          image: block.source.data,
          mediaType: block.source.media_type
        })
      }
    }

    flushUserContent()
    flushToolContent()
  }

  return converted
}

function convertAnthropicTools(tools?: MessageCreateParams['tools']): ToolSet | undefined {
  if (!tools?.length) {
    return undefined
  }

  const toolSet: ToolSet = {}
  for (const anthropicTool of tools) {
    if (!('name' in anthropicTool) || !('input_schema' in anthropicTool)) {
      continue
    }

    toolSet[anthropicTool.name] = tool({
      description: 'description' in anthropicTool ? anthropicTool.description : undefined,
      inputSchema: jsonSchema(anthropicTool.input_schema as JSONSchema7)
    })
  }

  return toolSet
}

function mapFinishReason(finishReason: string | undefined): AnthropicMessageResponse['stop_reason'] {
  switch (finishReason) {
    case 'tool-calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'stop':
      return 'end_turn'
    default:
      return 'end_turn'
  }
}

function buildUsage(usage?: { inputTokens?: number; outputTokens?: number }) {
  return {
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0
  }
}

async function buildExecution(
  provider: Provider,
  request: MessageCreateParams,
  requestedModelId?: string
): Promise<CompatExecution> {
  const resolvedModelId = requestedModelId ?? request.model
  const model = provider.models.find((entry) => entry.id === resolvedModelId)

  if (!model) {
    throw new Error(`Model '${resolvedModelId}' is not available for provider '${provider.id}'.`)
  }

  const executor = await getCompatExecutor(provider, model)
  const tools = convertAnthropicTools(request.tools)
  const system = normalizeSystemPrompt(request.system)

  const params: Record<string, unknown> = {
    maxOutputTokens: request.max_tokens,
    messages: convertAnthropicMessages(request.messages),
    model: model.id
  }

  if (system) {
    params.system = system
  }

  if (tools) {
    params.tools = tools
  }

  const toolChoice = convertToolChoice(request.tool_choice)
  if (toolChoice) {
    params.toolChoice = toolChoice
  }

  if (request.temperature !== undefined) {
    params.temperature = request.temperature
  }

  if (request.top_p !== undefined) {
    params.topP = request.top_p
  }

  if (request.top_k !== undefined) {
    params.topK = request.top_k
  }

  if (request.stop_sequences?.length) {
    params.stopSequences = request.stop_sequences
  }

  return {
    executor,
    model,
    params
  }
}

function buildCompatMessageResponse(result: any, model: Model): AnthropicMessageResponse {
  const content: Array<AnthropicTextBlock | AnthropicToolUseBlock> = []

  if (typeof result.text === 'string' && result.text.trim()) {
    content.push({
      type: 'text',
      text: result.text
    })
  }

  const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : []
  for (const toolCall of toolCalls) {
    content.push({
      type: 'tool_use',
      id: toolCall.toolCallId,
      name: toolCall.toolName,
      input: toolCall.input ?? toolCall.args ?? {}
    })
  }

  return {
    id: result.response?.id ?? `msg_${crypto.randomUUID().replace(/-/g, '')}`,
    type: 'message',
    role: 'assistant',
    content,
    model: model.id,
    stop_reason: mapFinishReason(result.finishReason),
    stop_sequence: null,
    usage: buildUsage(result.usage)
  }
}

function createMessageStartEvent(modelId: string) {
  return {
    type: 'message_start',
    message: {
      id: `msg_${crypto.randomUUID().replace(/-/g, '')}`,
      type: 'message',
      role: 'assistant',
      model: modelId,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0
      }
    }
  }
}

export async function createCompatMessage(provider: Provider, request: MessageCreateParams, requestedModelId?: string) {
  const execution = await buildExecution(provider, request, requestedModelId)
  const result = await execution.executor.generateText(execution.params as never)
  return buildCompatMessageResponse(result, execution.model)
}

export async function streamCompatMessage(
  provider: Provider,
  request: MessageCreateParams,
  requestedModelId: string | undefined,
  writeSse: (eventType: string | undefined, payload: unknown) => void
) {
  const execution = await buildExecution(provider, request, requestedModelId)
  const result = await execution.executor.streamText(execution.params as never)
  const reader = result.fullStream.getReader()

  let nextBlockIndex = 0
  let activeTextBlock: { id: string; index: number; lastText: string } | null = null
  const activeToolBlocks = new Map<string, { index: number; toolName: string }>()
  let emittedMessageDelta = false

  writeSse('message_start', createMessageStartEvent(execution.model.id))

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      switch (value.type) {
        case 'text-start': {
          activeTextBlock = {
            id: value.id,
            index: nextBlockIndex++,
            lastText: ''
          }
          writeSse('content_block_start', {
            type: 'content_block_start',
            index: activeTextBlock.index,
            content_block: {
              type: 'text',
              text: ''
            }
          })
          break
        }
        case 'text-delta': {
          if (!activeTextBlock) {
            activeTextBlock = {
              id: value.id,
              index: nextBlockIndex++,
              lastText: ''
            }
            writeSse('content_block_start', {
              type: 'content_block_start',
              index: activeTextBlock.index,
              content_block: {
                type: 'text',
                text: ''
              }
            })
          }

          const text = typeof value.text === 'string' ? value.text : ''
          const deltaText = text.startsWith(activeTextBlock.lastText)
            ? text.slice(activeTextBlock.lastText.length)
            : text
          activeTextBlock.lastText = text

          if (deltaText) {
            writeSse('content_block_delta', {
              type: 'content_block_delta',
              index: activeTextBlock.index,
              delta: {
                type: 'text_delta',
                text: deltaText
              }
            })
          }
          break
        }
        case 'text-end': {
          if (activeTextBlock) {
            writeSse('content_block_stop', {
              type: 'content_block_stop',
              index: activeTextBlock.index
            })
            activeTextBlock = null
          }
          break
        }
        case 'tool-input-start': {
          const block = {
            index: nextBlockIndex++,
            toolName: value.toolName
          }
          activeToolBlocks.set(value.id, block)
          writeSse('content_block_start', {
            type: 'content_block_start',
            index: block.index,
            content_block: {
              type: 'tool_use',
              id: value.id,
              name: value.toolName,
              input: {}
            }
          })
          break
        }
        case 'tool-input-delta': {
          const block = activeToolBlocks.get(value.id)
          if (!block) {
            logger.warn('Received tool-input-delta without active tool block', {
              providerId: provider.id,
              toolCallId: value.id
            })
            break
          }

          writeSse('content_block_delta', {
            type: 'content_block_delta',
            index: block.index,
            delta: {
              type: 'input_json_delta',
              partial_json: value.delta
            }
          })
          break
        }
        case 'tool-input-end': {
          const block = activeToolBlocks.get(value.id)
          if (!block) {
            break
          }

          writeSse('content_block_stop', {
            type: 'content_block_stop',
            index: block.index
          })
          activeToolBlocks.delete(value.id)
          break
        }
        case 'finish-step': {
          emittedMessageDelta = true
          writeSse('message_delta', {
            type: 'message_delta',
            delta: {
              stop_reason: mapFinishReason(value.finishReason),
              stop_sequence: null
            },
            usage: buildUsage(value.usage)
          })
          break
        }
        case 'finish': {
          if (!emittedMessageDelta) {
            writeSse('message_delta', {
              type: 'message_delta',
              delta: {
                stop_reason: mapFinishReason(value.finishReason),
                stop_sequence: null
              },
              usage: buildUsage(value.totalUsage)
            })
          }
          writeSse('message_stop', {
            type: 'message_stop'
          })
          break
        }
        default:
          break
      }
    }
  } finally {
    reader.releaseLock()
  }
}
