import { AssistantMessageStatus, type Message } from '@renderer/types/newMessage'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  useSession: vi.fn(),
  useAgent: vi.fn(),
  useTopicMessages: vi.fn(),
  loadTopicMessagesThunk: vi.fn((topicId: string) => ({ type: 'loadTopicMessagesThunk', payload: topicId })),
  setupChannelStream: vi.fn(),
  addChannelUserMessage: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  onChunk: vi.fn(),
  getGroupedMessages: vi.fn((messages: Message[]) => ({
    group: messages.map((message, index) => ({ ...message, index }))
  })),
  messageGroup: vi.fn(({ messages, topic }) => (
    <div data-testid="message-group" data-topic-id={topic.id}>
      {messages.map((message: Message) => (
        <article key={message.id} data-testid={`message-${message.id}`} data-role={message.role}>
          {message.blocks.join(',')}
        </article>
      ))}
    </div>
  ))
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      silly: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useSession: (...args: unknown[]) => mocks.useSession(...args)
}))

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgent: (...args: unknown[]) => mocks.useAgent(...args)
}))

vi.mock('@renderer/hooks/useMessageOperations', () => ({
  useTopicMessages: (...args: unknown[]) => mocks.useTopicMessages(...args)
}))

vi.mock('@renderer/hooks/useScrollPosition', () => ({
  default: () => ({
    containerRef: { current: null },
    handleScroll: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({
    messageNavigation: 'none'
  })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: (_name: string, callback: () => void) => callback()
  })
}))

vi.mock('@renderer/pages/home/Messages/MessageGroup', () => ({
  default: (props: any) => mocks.messageGroup(props)
}))

vi.mock('@renderer/pages/home/Messages/MessageAnchorLine', () => ({
  default: () => <div data-testid="message-anchor-line" />
}))

vi.mock('@renderer/pages/home/Messages/NarrowLayout', () => ({
  default: ({ children, style }: any) => (
    <div data-testid="narrow-layout" style={style}>
      {children}
    </div>
  )
}))

vi.mock('@renderer/pages/home/Messages/shared', () => ({
  MessagesContainer: ({ children, ...props }: any) => (
    <div data-testid="messages-container" {...props}>
      {children}
    </div>
  ),
  ScrollContainer: ({ children }: any) => <div data-testid="scroll-container">{children}</div>
}))

vi.mock('@renderer/components/ContextMenu', () => ({
  default: ({ children }: any) => <div data-testid="context-menu">{children}</div>
}))

vi.mock('@renderer/components/Icons', () => ({
  LoadingIcon: () => <span data-testid="loading-icon" />
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    SEND_MESSAGE: 'SEND_MESSAGE'
  },
  EventEmitter: {
    on: vi.fn(() => vi.fn()),
    off: vi.fn()
  }
}))

vi.mock('@renderer/services/MessagesService', () => ({
  getGroupedMessages: (messages: Message[]) => mocks.getGroupedMessages(messages)
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: vi.fn(() => ({}))
  },
  useAppDispatch: () => mocks.dispatch
}))

vi.mock('@renderer/store/thunk/messageThunk', () => ({
  addChannelUserMessage: (...args: Parameters<typeof mocks.addChannelUserMessage>) =>
    mocks.addChannelUserMessage(...args),
  loadTopicMessagesThunk: (topicId: string) => mocks.loadTopicMessagesThunk(topicId),
  setupChannelStream: (...args: Parameters<typeof mocks.setupChannelStream>) => mocks.setupChannelStream(...args)
}))

vi.mock('@renderer/utils/abortController', () => ({
  addAbortController: vi.fn(),
  removeAbortController: vi.fn()
}))

vi.mock('@renderer/utils/agentSession', () => ({
  buildAgentSessionTopicId: (sessionId: string) => `agent-session:${sessionId}`
}))

vi.mock('antd', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    Spin: ({ size }: any) => <div data-testid="spin" data-size={size} />
  }
})

vi.mock('react-infinite-scroll-component', () => ({
  default: ({ children }: any) => <div data-testid="infinite-scroll">{children}</div>
}))

import AgentSessionMessages from '../AgentSessionMessages'

describe('AgentSessionMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dispatch.mockReturnValue(undefined)
    mocks.subscribe.mockResolvedValue(undefined)
    mocks.unsubscribe.mockResolvedValue(undefined)
    mocks.onChunk.mockReturnValue(vi.fn())

    ;(window as any).api = {
      agentSessionStream: {
        subscribe: mocks.subscribe,
        unsubscribe: mocks.unsubscribe,
        onChunk: mocks.onChunk,
        abort: vi.fn()
      }
    }

    mocks.useSession.mockReturnValue({
      session: {
        id: 'session-1',
        agent_id: 'agent-1',
        name: 'Artifact session',
        created_at: '2026-06-03T00:00:00.000Z',
        updated_at: '2026-06-03T00:00:00.000Z',
        model: 'provider:model'
      }
    })
    mocks.useAgent.mockReturnValue({
      agent: {
        id: 'agent-1',
        model: 'provider:model'
      }
    })
  })

  it('routes agent-session assistant messages through the shared MessageGroup renderer', async () => {
    const assistantMessage: Message = {
      id: 'assistant-message-1',
      role: 'assistant',
      assistantId: 'agent-1',
      topicId: 'agent-session:session-1',
      createdAt: '2026-06-03T00:00:00.000Z',
      status: AssistantMessageStatus.SUCCESS,
      blocks: ['main-text-block-1']
    }

    mocks.useTopicMessages.mockReturnValue([assistantMessage])

    render(<AgentSessionMessages agentId="agent-1" sessionId="session-1" />)

    expect(mocks.loadTopicMessagesThunk).toHaveBeenCalledWith('agent-session:session-1')
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'loadTopicMessagesThunk',
      payload: 'agent-session:session-1'
    })
    expect(screen.getByTestId('message-group')).toHaveAttribute('data-topic-id', 'agent-session:session-1')
    expect(screen.getByTestId('message-assistant-message-1')).toHaveAttribute('data-role', 'assistant')
    expect(screen.getByTestId('message-assistant-message-1')).toHaveTextContent('main-text-block-1')

    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledWith('session-1'))
    expect(mocks.onChunk).toHaveBeenCalled()
  })
})
