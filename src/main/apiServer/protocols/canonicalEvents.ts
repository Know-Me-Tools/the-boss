import type { TextStreamPart } from 'ai'

/**
 * Normalized agent run events before mapping to AG-UI or A2A wire formats.
 * Keeps a single validation point for A2UI payloads extracted from streams.
 */
export type CanonicalAgentEvent =
  | { kind: 'run_start'; threadId: string; runId: string }
  | { kind: 'text_delta'; messageId: string; text: string; isCumulative: boolean }
  | { kind: 'text_block_end'; messageId: string }
  | {
      kind: 'a2ui_payload'
      messageId: string
      /** Validated root object ready for A2A DataPart or AG-UI generative UI channel */
      payload: Record<string, unknown>
    }
  | { kind: 'run_complete'; threadId: string; runId: string }
  | { kind: 'run_error'; message: string }
  | { kind: 'raw_chunk'; part: TextStreamPart<any> }
