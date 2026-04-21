import type { RuntimeMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RuntimeBlock from '../RuntimeBlock'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const createRuntimeBlock = (overrides: Partial<RuntimeMessageBlock> = {}): RuntimeMessageBlock => ({
  id: 'runtime-block-1',
  messageId: 'message-1',
  type: MessageBlockType.RUNTIME,
  status: MessageBlockStatus.PAUSED,
  createdAt: new Date().toISOString(),
  runtime: 'opencode',
  sessionId: 'session-123',
  approval: {
    kind: 'opencode-permission',
    permissionId: 'perm-123',
    responses: ['allow', 'deny']
  },
  events: [
    {
      eventKind: 'status',
      runtime: 'opencode',
      title: 'session.status',
      summary: 'running',
      data: {
        runtime: 'opencode',
        phase: 'session.status'
      },
      createdAt: new Date().toISOString()
    },
    {
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
      },
      createdAt: new Date().toISOString()
    }
  ],
  ...overrides
})

describe('RuntimeBlock', () => {
  beforeEach(() => {
    window.api = {
      agentRuntime: {
        respondToApproval: vi.fn(async () => ({ success: true }))
      }
    } as never
  })

  it('renders runtime identity, latest event, and approval options', () => {
    render(<RuntimeBlock block={createRuntimeBlock()} />)

    expect(screen.getByText('opencode')).toBeInTheDocument()
    expect(screen.getAllByText('permission.updated')).not.toHaveLength(0)
    expect(screen.getAllByText('perm-123')).not.toHaveLength(0)
    expect(screen.getByText('session-123')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'allow' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'deny' })).toBeInTheDocument()
  })

  it('keeps raw runtime payload behind a collapsed debug disclosure', () => {
    render(<RuntimeBlock block={createRuntimeBlock()} />)

    const debug = screen.getByText('message.block.runtime.debug')
    expect(debug.closest('details')).not.toHaveAttribute('open')
  })

  it('sends approval responses to the runtime backend', async () => {
    render(<RuntimeBlock block={createRuntimeBlock()} />)

    fireEvent.click(screen.getByRole('button', { name: 'allow' }))

    await waitFor(() => {
      expect(window.api.agentRuntime.respondToApproval).toHaveBeenCalledWith({
        runtime: 'opencode',
        sessionId: 'session-123',
        permissionId: 'perm-123',
        response: 'allow'
      })
    })
  })
})
