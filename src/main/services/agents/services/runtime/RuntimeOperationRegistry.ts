import { randomUUID } from 'node:crypto'

export type RuntimeOperationStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface RuntimeOperationProgress {
  operationId: string
  status: RuntimeOperationStatus
  phase: string
  progress?: number
  receivedBytes?: number
  totalBytes?: number
  message?: string
  code?: string
  lastActivityAt: string
}

export interface RuntimeOperation {
  operationId: string
  signal: AbortSignal
}

class RuntimeOperationRegistry {
  private readonly operations = new Map<string, AbortController>()

  start(operationId = randomUUID()): RuntimeOperation {
    this.cancel(operationId, 'Superseded by a new runtime operation with the same id.')

    const controller = new AbortController()
    this.operations.set(operationId, controller)

    return {
      operationId,
      signal: controller.signal
    }
  }

  cancel(operationId: string, reason = 'Runtime operation cancelled.'): boolean {
    const controller = this.operations.get(operationId)
    if (!controller) {
      return false
    }

    controller.abort(new Error(reason))
    this.operations.delete(operationId)
    return true
  }

  finish(operationId: string): void {
    this.operations.delete(operationId)
  }
}

export const runtimeOperationRegistry = new RuntimeOperationRegistry()
