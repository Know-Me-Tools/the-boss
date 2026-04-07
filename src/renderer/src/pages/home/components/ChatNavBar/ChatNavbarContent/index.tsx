import type { Assistant, Topic } from '@renderer/types'
import type { FC } from 'react'

import TopicContent from './TopicContent'

interface Props {
  assistant: Assistant
  activeTopic: Topic
}

const ChatNavbarContent: FC<Props> = ({ assistant, activeTopic }) => {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between">
      <TopicContent assistant={assistant} activeTopic={activeTopic} />
    </div>
  )
}

export default ChatNavbarContent
