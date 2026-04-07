/** Last total token count observed from a finish chunk, keyed by app session id. */
const lastTotalTokensBySessionId = new Map<string, number>()

export function setAgentSessionLastTotalTokens(sessionId: string, totalTokens: number): void {
  lastTotalTokensBySessionId.set(sessionId, totalTokens)
}

export function getAgentSessionLastTotalTokens(sessionId: string): number | undefined {
  return lastTotalTokensBySessionId.get(sessionId)
}

/** For tests only */
export function clearAgentSessionUsageCacheForTests(): void {
  lastTotalTokensBySessionId.clear()
}
