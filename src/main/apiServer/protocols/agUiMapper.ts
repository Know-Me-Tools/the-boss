import { randomUUID } from 'node:crypto'

import type { ContextManagementStreamPayload } from '@shared/contextManagementStream'
import type {
  SkillActivatedStreamPayload,
  SkillCompleteStreamPayload,
  SkillContentDeltaStreamPayload
} from '@shared/skillStream'
import type { TextStreamPart } from 'ai'

import { A2A_PROTOCOL_VERSION, A2UI_SCHEMA_VERSION, AG_UI_DOCS_REFERENCE } from './versions'

/** AG-UI-shaped events (subset aligned with docs.ag-ui.com event categories). */
export type AgUiWireEvent =
  | {
      type: 'RunStarted'
      threadId: string
      runId: string
      timestamp?: number
    }
  | {
      type: 'TEXT_MESSAGE_START'
      messageId: string
      role: 'assistant'
    }
  | {
      type: 'TEXT_MESSAGE_CONTENT'
      messageId: string
      delta: string
    }
  | {
      type: 'TEXT_MESSAGE_END'
      messageId: string
    }
  | {
      type: 'RunFinished'
      threadId: string
      runId: string
      timestamp?: number
    }
  | {
      type: 'RunError'
      message: string
    }
  /** Vendor extension — namespaced custom type for protocol bundle discovery */
  | {
      type: 'theboss.protocol.meta'
      payload: {
        agUiDocs: string
        a2aVersion: string
        a2uiSchemaVersion: string
      }
    }
  /** Optional passthrough for debugging (clients may ignore) */
  | {
      type: 'theboss.raw.aiSdkPart'
      part: TextStreamPart<any>
    }
  /** Context management (chat pipeline or SDK /compact) */
  | {
      type: 'theboss.context_management'
      payload: ContextManagementStreamPayload
    }
  | {
      type: 'theboss.skill_activated'
      payload: SkillActivatedStreamPayload
    }
  | {
      type: 'theboss.skill_content_delta'
      payload: SkillContentDeltaStreamPayload
    }
  | {
      type: 'theboss.skill_complete'
      payload: SkillCompleteStreamPayload
    }

export interface AgUiMapperState {
  threadId: string
  runId: string
  assistantMessageId: string
  started: boolean
  /** AI SDK text-delta chunks are cumulative within a block — track for true deltas */
  lastTextInBlock: string
}

export function createAgUiMapperState(threadId: string): AgUiMapperState {
  return {
    threadId,
    runId: randomUUID(),
    assistantMessageId: randomUUID(),
    started: false,
    lastTextInBlock: ''
  }
}

export function mapTextStreamPartToAgUiEvents(state: AgUiMapperState, part: TextStreamPart<any>): AgUiWireEvent[] {
  const out: AgUiWireEvent[] = []
  if (!state.started) {
    state.started = true
    out.push({
      type: 'RunStarted',
      threadId: state.threadId,
      runId: state.runId,
      timestamp: Date.now()
    })
    out.push({
      type: 'theboss.protocol.meta',
      payload: {
        agUiDocs: AG_UI_DOCS_REFERENCE,
        a2aVersion: A2A_PROTOCOL_VERSION,
        a2uiSchemaVersion: A2UI_SCHEMA_VERSION
      }
    })
    out.push({
      type: 'TEXT_MESSAGE_START',
      messageId: state.assistantMessageId,
      role: 'assistant'
    })
  }

  switch (part.type) {
    case 'text-delta': {
      const full = typeof part.text === 'string' ? part.text : ''
      let delta = ''
      if (full.length > 0) {
        if (full.startsWith(state.lastTextInBlock)) {
          delta = full.slice(state.lastTextInBlock.length)
        } else {
          delta = full
        }
        state.lastTextInBlock = full
      }
      if (delta.length > 0) {
        out.push({
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: state.assistantMessageId,
          delta
        })
      }
      break
    }
    case 'text-end':
      state.lastTextInBlock = ''
      out.push({ type: 'TEXT_MESSAGE_END', messageId: state.assistantMessageId })
      break
    default: {
      const asRec = part as unknown as {
        type?: string
        data?:
          | ContextManagementStreamPayload
          | SkillActivatedStreamPayload
          | SkillContentDeltaStreamPayload
          | SkillCompleteStreamPayload
      }
      if (asRec.type === 'data-context-management' && asRec.data) {
        out.push({ type: 'theboss.context_management', payload: asRec.data as ContextManagementStreamPayload })
        break
      }
      if (asRec.type === 'data-skill-activated' && asRec.data) {
        out.push({ type: 'theboss.skill_activated', payload: asRec.data as SkillActivatedStreamPayload })
        break
      }
      if (asRec.type === 'data-skill-content-delta' && asRec.data) {
        out.push({ type: 'theboss.skill_content_delta', payload: asRec.data as SkillContentDeltaStreamPayload })
        break
      }
      if (asRec.type === 'data-skill-complete' && asRec.data) {
        out.push({ type: 'theboss.skill_complete', payload: asRec.data as SkillCompleteStreamPayload })
        break
      }
      out.push({ type: 'theboss.raw.aiSdkPart', part })
      break
    }
  }

  return out
}

export function agUiRunFinished(state: AgUiMapperState): AgUiWireEvent[] {
  return [
    {
      type: 'RunFinished',
      threadId: state.threadId,
      runId: state.runId,
      timestamp: Date.now()
    }
  ]
}

export function agUiRunError(message: string): AgUiWireEvent {
  return { type: 'RunError', message }
}
