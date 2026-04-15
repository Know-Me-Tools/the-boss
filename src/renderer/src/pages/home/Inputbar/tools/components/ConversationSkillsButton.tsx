import { ActionIconButton } from '@renderer/components/Buttons'
import type { ToolQuickPanelApi, ToolQuickPanelController } from '@renderer/pages/home/Inputbar/types'
import type { Assistant, Topic } from '@renderer/types'
import { Tooltip } from 'antd'
import { Zap } from 'lucide-react'
import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { useConversationSkillsPanel } from './useConversationSkillsPanel'

interface Props {
  quickPanel: ToolQuickPanelApi
  quickPanelController: ToolQuickPanelController
  assistant: Assistant
  topic: Topic
  updateTopic: (topic: Topic) => void
}

const ConversationSkillsButton: FC<Props> = ({ quickPanel, quickPanelController, assistant, topic, updateTopic }) => {
  const { t } = useTranslation()
  const { handleOpenQuickPanel } = useConversationSkillsPanel({
    quickPanel,
    quickPanelController,
    assistant,
    topic,
    updateTopic
  })

  return (
    <Tooltip
      placement="top"
      title={t('chat.input.conversation_skills.title', {
        defaultValue: 'Conversation Skills'
      })}
      mouseLeaveDelay={0}
      arrow>
      <ActionIconButton
        onClick={handleOpenQuickPanel}
        aria-label={t('chat.input.conversation_skills.title', {
          defaultValue: 'Conversation Skills'
        })}>
        <Zap size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default memo(ConversationSkillsButton)
