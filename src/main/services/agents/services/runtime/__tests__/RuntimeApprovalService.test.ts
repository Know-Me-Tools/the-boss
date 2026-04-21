import { describe, expect, it, vi } from 'vitest'

const respondToOpenCodePermissionMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

vi.mock('../OpenCodeRuntimeAdapter', () => ({
  respondToOpenCodePermission: respondToOpenCodePermissionMock
}))

import { RuntimeApprovalService } from '../RuntimeApprovalService'

describe('RuntimeApprovalService', () => {
  it('delegates OpenCode permission responses to the OpenCode runtime adapter', async () => {
    const service = new RuntimeApprovalService()

    await expect(
      service.respond({
        runtime: 'opencode',
        sessionId: 'session-1',
        permissionId: 'permission-1',
        response: 'allow'
      })
    ).resolves.toEqual({ success: true })

    expect(respondToOpenCodePermissionMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      permissionId: 'permission-1',
      response: 'allow'
    })
  })

  it('returns explicit unsupported results for runtimes without approval protocols', async () => {
    const service = new RuntimeApprovalService()

    await expect(
      service.respond({
        runtime: 'uar',
        sessionId: 'session-1',
        permissionId: 'permission-1',
        response: 'allow'
      })
    ).resolves.toMatchObject({
      success: false,
      unsupported: true
    })
  })
})
