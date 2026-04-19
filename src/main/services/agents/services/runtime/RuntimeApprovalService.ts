import { loggerService } from '@logger'
import type { AgentRuntimeKind } from '@types'

import { respondToOpenCodePermission } from './OpenCodeRuntimeAdapter'

const logger = loggerService.withContext('RuntimeApprovalService')

export interface RuntimeApprovalResponseRequest {
  runtime: AgentRuntimeKind
  sessionId: string
  permissionId: string
  response: string
}

export interface RuntimeApprovalResponseResult {
  success: boolean
  unsupported?: boolean
  message?: string
}

export class RuntimeApprovalService {
  async respond(request: RuntimeApprovalResponseRequest): Promise<RuntimeApprovalResponseResult> {
    if (!request.sessionId || !request.permissionId) {
      throw new Error('Runtime approval response requires a session id and permission id.')
    }

    if (request.runtime === 'opencode') {
      await respondToOpenCodePermission({
        sessionId: request.sessionId,
        permissionId: request.permissionId,
        response: request.response
      })
      return { success: true }
    }

    const message = `${request.runtime} runtime approval responses are not supported yet.`
    logger.warn('Unsupported runtime approval response', {
      runtime: request.runtime,
      sessionId: request.sessionId,
      permissionId: request.permissionId
    })
    return {
      success: false,
      unsupported: true,
      message
    }
  }
}

export const runtimeApprovalService = new RuntimeApprovalService()
