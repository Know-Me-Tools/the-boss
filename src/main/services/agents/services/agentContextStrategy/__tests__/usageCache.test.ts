import { afterEach, describe, expect, it } from 'vitest'

import {
  clearAgentSessionUsageCacheForTests,
  getAgentSessionLastTotalTokens,
  setAgentSessionLastTotalTokens
} from '../usageCache'

describe('agentSession usageCache', () => {
  afterEach(() => {
    clearAgentSessionUsageCacheForTests()
  })

  it('stores last total tokens per app session id', () => {
    setAgentSessionLastTotalTokens('session-a', 100_000)
    setAgentSessionLastTotalTokens('session-b', 200_000)
    expect(getAgentSessionLastTotalTokens('session-a')).toBe(100_000)
    expect(getAgentSessionLastTotalTokens('session-b')).toBe(200_000)
  })
})
