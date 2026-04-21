import { loggerService } from '@logger'
import type { RuntimeEventChunk } from '@renderer/types/chunk'
import type { RuntimeMessageBlock, RuntimeMessageBlockEvent } from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'
import { createRuntimeBlock, createRuntimeBlockEvent, getRuntimeBlockStatus } from '@renderer/utils/messageUtils/create'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('RuntimeCallbacks')

interface RuntimeCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
}

export interface RuntimeCallbacks {
  onRuntimeEvent: (chunk: RuntimeEventChunk) => Promise<void>
}

export const createRuntimeCallbacks = (deps: RuntimeCallbacksDependencies): RuntimeCallbacks => {
  const { blockManager, assistantMsgId } = deps
  let runtimeBlockId: string | null = null
  let runtimeName: string | undefined
  let sessionId: string | undefined
  let approval: RuntimeMessageBlock['approval']
  const events: RuntimeMessageBlockEvent[] = []

  return {
    onRuntimeEvent: async (chunk: RuntimeEventChunk) => {
      const nextEvent = createRuntimeBlockEvent(chunk)
      events.push(nextEvent)
      runtimeName = runtimeName ?? chunk.runtime
      sessionId = sessionId ?? getRuntimeSessionId(chunk.data)
      approval = chunk.approval ?? approval

      if (!runtimeBlockId) {
        const block = createRuntimeBlock(assistantMsgId, chunk, {
          runtime: runtimeName,
          sessionId,
          approval
        })
        runtimeBlockId = block.id
        try {
          await blockManager.handleBlockTransition(block, MessageBlockType.RUNTIME)
        } catch (err) {
          logger.error('[onRuntimeEvent] Failed to transition runtime block', err as Error)
          runtimeBlockId = null
        }
        return
      }

      const changes: Partial<RuntimeMessageBlock> = {
        runtime: runtimeName,
        sessionId,
        events: [...events],
        approval,
        status: getRuntimeBlockStatus(chunk)
      }
      blockManager.smartBlockUpdate(runtimeBlockId, changes, MessageBlockType.RUNTIME, chunk.eventKind === 'usage')
    }
  }
}

function getRuntimeSessionId(data: Record<string, unknown>): string | undefined {
  return typeof data.runtimeSessionId === 'string' ? data.runtimeSessionId : undefined
}
