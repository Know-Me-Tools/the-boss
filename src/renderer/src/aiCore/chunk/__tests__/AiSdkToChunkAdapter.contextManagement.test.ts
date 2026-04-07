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
})
