import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'

import ConversationSkillsButton from './components/ConversationSkillsButton'
import ConversationSkillsQuickPanelManager from './components/ConversationSkillsQuickPanelManager'

const conversationSkillsTool = defineTool({
  key: 'conversation_skills',
  label: (t) =>
    t('chat.input.conversation_skills.title', {
      defaultValue: 'Conversation Skills'
    }),
  visibleInScopes: [TopicType.Chat],
  dependencies: {
    state: [] as const,
    actions: [] as const
  },
  condition: (context) => !!context.conversation,
  render: function ConversationSkillsToolRender(context) {
    const { assistant, conversation, quickPanel, quickPanelController } = context

    if (!conversation) {
      return null
    }

    return (
      <ConversationSkillsButton
        quickPanel={quickPanel}
        quickPanelController={quickPanelController}
        assistant={assistant}
        topic={conversation.topic}
        updateTopic={conversation.updateTopic}
      />
    )
  },
  quickPanelManager: ConversationSkillsQuickPanelManager
})

registerTool(conversationSkillsTool)

export default conversationSkillsTool
