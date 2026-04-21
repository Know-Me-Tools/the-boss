import type { RuntimeEventChunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRuntimeCallbacks } from '../runtimeCallbacks'

const createMockBlockManager = () => ({
  handleBlockTransition: vi.fn().mockResolvedValue(undefined),
  smartBlockUpdate: vi.fn(),
  hasInitialPlaceholder: false,
  initialPlaceholderBlockId: null,
  lastBlockType: null,
  activeBlockInfo: null
})

describe('createRuntimeCallbacks', () => {
  const assistantMsgId = 'msg-assistant-runtime'
  let blockManager: ReturnType<typeof createMockBlockManager>
  let callbacks: ReturnType<typeof createRuntimeCallbacks>

  beforeEach(() => {
    vi.clearAllMocks()
    blockManager = createMockBlockManager()
    callbacks = createRuntimeCallbacks({ blockManager: blockManager as any, assistantMsgId })
  })

  it('creates one runtime block for the first runtime event', async () => {
    const chunk: RuntimeEventChunk = {
      type: ChunkType.RUNTIME_EVENT,
      eventKind: 'status',
      runtime: 'codex',
      title: 'thread.started',
      summary: 'thread-123',
      data: {
        runtime: 'codex',
        phase: 'thread.started',
        runtimeSessionId: 'thread-123'
      }
    }

    await callbacks.onRuntimeEvent(chunk)

    expect(blockManager.handleBlockTransition).toHaveBeenCalledTimes(1)
    const [passedBlock, blockType] = blockManager.handleBlockTransition.mock.calls[0]
    expect(blockType).toBe(MessageBlockType.RUNTIME)
    expect(passedBlock.type).toBe(MessageBlockType.RUNTIME)
    expect(passedBlock.messageId).toBe(assistantMsgId)
    expect(passedBlock.runtime).toBe('codex')
    expect(passedBlock.status).toBe(MessageBlockStatus.STREAMING)
    expect(passedBlock.events).toEqual([
      expect.objectContaining({
        eventKind: 'status',
        title: 'thread.started',
        summary: 'thread-123'
      })
    ])
  })

  it('appends approval events to the existing runtime block', async () => {
    const statusChunk: RuntimeEventChunk = {
      type: ChunkType.RUNTIME_EVENT,
      eventKind: 'status',
      runtime: 'opencode',
      title: 'session.status',
      summary: 'running',
      data: {
        runtime: 'opencode',
        phase: 'session.status',
        status: 'running'
      }
    }
    await callbacks.onRuntimeEvent(statusChunk)
    const [createdBlock] = blockManager.handleBlockTransition.mock.calls[0]

    const approvalChunk: RuntimeEventChunk = {
      type: ChunkType.RUNTIME_EVENT,
      eventKind: 'approval',
      runtime: 'opencode',
      title: 'permission.updated',
      summary: 'perm-123',
      approval: {
        kind: 'opencode-permission',
        permissionId: 'perm-123',
        responses: ['allow', 'deny']
      },
      data: {
        runtime: 'opencode',
        eventType: 'permission.updated'
      }
    }

    await callbacks.onRuntimeEvent(approvalChunk)

    expect(blockManager.smartBlockUpdate).toHaveBeenCalledTimes(1)
    const [blockId, changes, blockType] = blockManager.smartBlockUpdate.mock.calls[0]
    expect(blockId).toBe(createdBlock.id)
    expect(blockType).toBe(MessageBlockType.RUNTIME)
    expect(changes.status).toBe(MessageBlockStatus.PAUSED)
    expect(changes.approval).toEqual(approvalChunk.approval)
    expect(changes.events).toHaveLength(2)
    expect(changes.events[1]).toEqual(
      expect.objectContaining({
        eventKind: 'approval',
        title: 'permission.updated',
        summary: 'perm-123'
      })
    )
  })
})
