import type { AppDispatch, RootState } from '@renderer/store'
import { upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import type { ContextManagementMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createContextManagementBlock } from '@renderer/utils/messageUtils/create'
import type { ContextManagementStreamPayload } from '@shared/contextManagementStream'

import type { BlockManager } from '../BlockManager'

interface ContextManagementCallbacksDeps {
  blockManager: BlockManager
  assistantMsgId: string
  dispatch: AppDispatch
  getState: () => RootState
  topicId: string
  saveUpdatesToDB: (
    messageId: string,
    topicId: string,
    messageUpdates: Partial<{ blocks: string[] }>,
    blocksToUpdate: ContextManagementMessageBlock[]
  ) => Promise<void>
}

export const createContextManagementCallbacks = (deps: ContextManagementCallbacksDeps) => {
  const { blockManager, assistantMsgId, dispatch, getState, topicId, saveUpdatesToDB } = deps

  const onContextManagement = async (payload: ContextManagementStreamPayload) => {
    const block = createContextManagementBlock(assistantMsgId, payload, {
      status: MessageBlockStatus.SUCCESS
    })

    dispatch(upsertOneBlock(block))

    dispatch(
      newMessagesActions.upsertBlockReference({
        messageId: assistantMsgId,
        blockId: block.id,
        status: MessageBlockStatus.SUCCESS,
        blockType: MessageBlockType.CONTEXT_MANAGEMENT
      })
    )

    blockManager.lastBlockType = MessageBlockType.CONTEXT_MANAGEMENT

    const message = getState().messages.entities[assistantMsgId]
    if (message) {
      await saveUpdatesToDB(assistantMsgId, topicId, { blocks: message.blocks }, [block])
    }
  }

  return { onContextManagement }
}
