import type { TextStreamPart } from 'ai'

/**
 * Read cumulative usage from an AI SDK stream `finish` part (Claude Code pipeline).
 */
export function extractTotalTokensFromFinishPart(part: TextStreamPart<Record<string, any>>): number | undefined {
  if (part.type !== 'finish') {
    return undefined
  }
  const p = part as { totalUsage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number } }
  const u = p.totalUsage
  if (!u) {
    return undefined
  }
  if (typeof u.totalTokens === 'number') {
    return u.totalTokens
  }
  const input = typeof u.inputTokens === 'number' ? u.inputTokens : 0
  const output = typeof u.outputTokens === 'number' ? u.outputTokens : 0
  return input + output
}
