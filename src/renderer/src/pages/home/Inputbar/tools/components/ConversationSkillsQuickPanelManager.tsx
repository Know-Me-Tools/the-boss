import type { ToolRenderContext } from '@renderer/pages/home/Inputbar/types'

import { useConversationSkillsPanel } from './useConversationSkillsPanel'

const ConversationSkillsQuickPanelBinding = ({
  context
}: {
  context: ToolRenderContext<readonly [], readonly []> & {
    conversation: NonNullable<ToolRenderContext<readonly [], readonly []>['conversation']>
  }
}) => {
  const { assistant, conversation, quickPanel, quickPanelController } = context

  useConversationSkillsPanel({
    quickPanel,
    quickPanelController,
    assistant,
    topic: conversation.topic,
    updateTopic: conversation.updateTopic
  })

  return null
}

const ConversationSkillsQuickPanelManager = ({
  context
}: {
  context: ToolRenderContext<readonly [], readonly []>
}) => {
  if (!conversation) {
    return null
  }

  return <ConversationSkillsQuickPanelBinding context={{ ...context, conversation }} />
}

export default ConversationSkillsQuickPanelManager
