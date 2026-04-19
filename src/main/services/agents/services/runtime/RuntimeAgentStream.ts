import { EventEmitter } from 'node:events'

import type { TextStreamPart } from 'ai'

import type { AgentStream, AgentStreamEvent } from '../../interfaces/AgentStreamInterface'

export class RuntimeAgentStream extends EventEmitter implements AgentStream {
  declare emit: (event: 'data', data: AgentStreamEvent) => boolean
  declare on: (event: 'data', listener: (data: AgentStreamEvent) => void) => this
  declare once: (event: 'data', listener: (data: AgentStreamEvent) => void) => this
  sdkSessionId?: string

  emitChunk(chunk: TextStreamPart<Record<string, any>>): void {
    this.emit('data', { type: 'chunk', chunk })
  }

  emitError(error: Error): void {
    this.emit('data', { type: 'error', error })
  }

  emitComplete(): void {
    this.emit('data', { type: 'complete' })
  }
}

export function enqueueRuntimeError(error: Error): AgentStream {
  const stream = new RuntimeAgentStream()
  queueMicrotask(() => {
    stream.emitError(error)
  })
  return stream
}

export function emitTextBlock(stream: RuntimeAgentStream, text: string): void {
  if (!text) return

  stream.emitChunk({
    type: 'text-start',
    id: 'runtime-text'
  } as unknown as TextStreamPart<Record<string, any>>)
  stream.emitChunk({
    type: 'text-delta',
    id: 'runtime-text',
    text
  } as unknown as TextStreamPart<Record<string, any>>)
  stream.emitChunk({
    type: 'text-end',
    id: 'runtime-text',
    providerMetadata: {
      text: {
        value: text
      }
    }
  } as unknown as TextStreamPart<Record<string, any>>)
}
