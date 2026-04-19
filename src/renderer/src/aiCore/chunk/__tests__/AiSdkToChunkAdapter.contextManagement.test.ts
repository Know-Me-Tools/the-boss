import type { ExternalToolResult } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import { ContextManagementMethod, SkillSelectionMethod } from '@renderer/types/skillConfig'
import type { ContextManagementStreamPayload } from '@shared/contextManagementStream'
import type {
  SkillActivatedStreamPayload,
  SkillCompleteStreamPayload,
  SkillContentDeltaStreamPayload
} from '@shared/skillStream'
import { describe, expect, it, vi } from 'vitest'

import AiSdkToChunkAdapter from '../AiSdkToChunkAdapter'

describe('AiSdkToChunkAdapter data-context-management', () => {
  it('emits CONTEXT_MANAGEMENT chunk', async () => {
    const onChunk = vi.fn()
    const adapter = new AiSdkToChunkAdapter(onChunk, [], false, false)

    const payload: ContextManagementStreamPayload = {
      surface: 'agent',
      strategyType: 'sliding_window',
      alterationSummary: 'test',
      trigger: 'sdk_compact_pre_turn'
    }

    await adapter.processStream({
      fullStream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'data-context-management',
            data: payload
          } as any)
          controller.close()
        }
      }),
      text: Promise.resolve('')
    })

    expect(onChunk).toHaveBeenCalledWith({
      type: ChunkType.CONTEXT_MANAGEMENT,
      payload
    })
  })

  it('emits skill lifecycle chunks from backend synthetic skill events', async () => {
    const onChunk = vi.fn()
    const adapter = new AiSdkToChunkAdapter(onChunk, [], false, false)

    const activated: SkillActivatedStreamPayload = {
      skillId: 'skill-1',
      skillName: 'Planning Skill',
      triggerTokens: ['plan'],
      selectionReason: 'Matched planning intent',
      activationMethod: SkillSelectionMethod.HYBRID,
      similarityScore: 0.91,
      matchedKeywords: ['plan'],
      contextManagementMethod: ContextManagementMethod.PREFIX_CACHE_AWARE,
      content: '<skill_context>content</skill_context>',
      originalTokenCount: 120,
      managedTokenCount: 64,
      tokensSaved: 56,
      truncated: true
    }

    const delta: SkillContentDeltaStreamPayload = {
      skillId: 'skill-1',
      delta: '<skill_context>content</skill_context>'
    }

    const complete: SkillCompleteStreamPayload = {
      skillId: 'skill-1',
      finalTokenCount: 64
    }

    await adapter.processStream({
      fullStream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'data-skill-activated', data: activated } as any)
          controller.enqueue({ type: 'data-skill-content-delta', data: delta } as any)
          controller.enqueue({ type: 'data-skill-complete', data: complete } as any)
          controller.close()
        }
      }),
      text: Promise.resolve('')
    })

    expect(onChunk).toHaveBeenNthCalledWith(1, {
      type: ChunkType.SKILL_ACTIVATED,
      ...activated
    })
    expect(onChunk).toHaveBeenNthCalledWith(2, {
      type: ChunkType.SKILL_CONTENT_DELTA,
      ...delta
    })
    expect(onChunk).toHaveBeenNthCalledWith(3, {
      type: ChunkType.SKILL_COMPLETE,
      ...complete
    })
  })

  it('emits external tool citation chunks from backend knowledge retrieval events', async () => {
    const onChunk = vi.fn()
    const adapter = new AiSdkToChunkAdapter(onChunk, [], false, false)

    const externalTool: ExternalToolResult = {
      knowledge: [
        {
          id: 1,
          content: 'Relevant paragraph',
          sourceUrl: 'https://example.com/docs',
          type: 'url',
          metadata: {
            source: 'https://example.com/docs',
            type: 'url'
          }
        }
      ]
    }

    await adapter.processStream({
      fullStream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'data-external-tool-in-progress' } as any)
          controller.enqueue({ type: 'data-external-tool-complete', data: externalTool } as any)
          controller.close()
        }
      }),
      text: Promise.resolve('')
    })

    expect(onChunk).toHaveBeenNthCalledWith(1, {
      type: ChunkType.EXTERNEL_TOOL_IN_PROGRESS
    })
    expect(onChunk).toHaveBeenNthCalledWith(2, {
      type: ChunkType.EXTERNEL_TOOL_COMPLETE,
      external_tool: externalTool
    })
  })

  it('emits normalized runtime chunks from backend runtime telemetry events', async () => {
    const onChunk = vi.fn()
    const adapter = new AiSdkToChunkAdapter(onChunk, [], false, false)

    const statusPayload = {
      runtime: 'codex',
      phase: 'thread.started',
      runtimeSessionId: 'thread-123',
      config: {
        model: 'gpt-5.4',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write'
      }
    }

    const approvalPayload = {
      runtime: 'opencode',
      eventType: 'permission.updated',
      approval: {
        kind: 'opencode-permission',
        permissionId: 'perm-123',
        responses: ['allow', 'deny']
      }
    }

    const rawRuntimePayload = {
      runtime: 'uar',
      event: 'models',
      payload: {
        data: [{ id: 'model-a' }]
      }
    }

    await adapter.processStream({
      fullStream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'data-agent-runtime-status', data: statusPayload } as any)
          controller.enqueue({ type: 'data-agent-runtime-permission', data: approvalPayload } as any)
          controller.enqueue({ type: 'data-agent-runtime-event', data: rawRuntimePayload } as any)
          controller.close()
        }
      }),
      text: Promise.resolve('')
    })

    expect(onChunk).toHaveBeenNthCalledWith(1, {
      type: 'runtime.event',
      eventKind: 'status',
      runtime: 'codex',
      title: 'thread.started',
      summary: 'thread-123',
      data: statusPayload
    })
    expect(onChunk).toHaveBeenNthCalledWith(2, {
      type: 'runtime.event',
      eventKind: 'approval',
      runtime: 'opencode',
      title: 'permission.updated',
      summary: 'perm-123',
      approval: approvalPayload.approval,
      data: approvalPayload
    })
    expect(onChunk).toHaveBeenNthCalledWith(3, {
      type: 'runtime.event',
      eventKind: 'event',
      runtime: 'uar',
      title: 'models',
      summary: '1 model',
      data: rawRuntimePayload
    })
  })
})
