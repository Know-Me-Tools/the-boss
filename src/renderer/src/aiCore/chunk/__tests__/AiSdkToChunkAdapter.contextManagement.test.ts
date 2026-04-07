import { ChunkType } from '@renderer/types/chunk'
import type { ContextManagementStreamPayload } from '@shared/contextManagementStream'
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
})
