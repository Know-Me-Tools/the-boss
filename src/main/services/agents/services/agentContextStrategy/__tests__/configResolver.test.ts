import { describe, expect, it } from 'vitest'

import {
  DEFAULT_AGENT_COMPACT_TRIGGER_TOKENS,
  getEffectiveAgentContextStrategy,
  isAgentContextStrategyEnabled
} from '../configResolver'
import { shouldRunSdkCompactBeforeTurn } from '../preCompact'
import { clearAgentSessionUsageCacheForTests, setAgentSessionLastTotalTokens } from '../usageCache'

describe('getEffectiveAgentContextStrategy', () => {
  it('merges session over agent over global', () => {
    const resolved = getEffectiveAgentContextStrategy({
      globalStrategy: { type: 'sliding_window', maxMessages: 10 },
      agentConfiguration: { context_strategy: { type: 'summarize', summaryMaxTokens: 800 } },
      sessionConfiguration: { context_strategy: { type: 'none' } }
    })
    expect(resolved.type).toBe('none')
  })

  it('applies agent over global', () => {
    const resolved = getEffectiveAgentContextStrategy({
      globalStrategy: { type: 'sliding_window', compactTriggerTokens: 100 },
      agentConfiguration: { context_strategy: { compactTriggerTokens: 50 } }
    })
    expect(resolved.compactTriggerTokens).toBe(50)
  })

  it('injects global summarization model id when strategy omits it', () => {
    const resolved = getEffectiveAgentContextStrategy({
      globalStrategy: { type: 'summarize' },
      globalSummarizationModelId: 'm1'
    })
    expect(resolved.summarizationModelId).toBe('m1')
  })
})

describe('shouldRunSdkCompactBeforeTurn', () => {
  it('returns false when strategy is none', () => {
    expect(
      shouldRunSdkCompactBeforeTurn({
        appSessionId: 's1',
        sdkSessionIdForResume: 'sdk',
        userPrompt: 'hi',
        config: { type: 'none' }
      })
    ).toBe(false)
  })

  it('returns false without sdk resume id', () => {
    setAgentSessionLastTotalTokens('s1', DEFAULT_AGENT_COMPACT_TRIGGER_TOKENS + 1)
    expect(
      shouldRunSdkCompactBeforeTurn({
        appSessionId: 's1',
        sdkSessionIdForResume: undefined,
        userPrompt: 'hi',
        config: { type: 'sliding_window' }
      })
    ).toBe(false)
    clearAgentSessionUsageCacheForTests()
  })

  it('returns true when usage meets threshold', () => {
    setAgentSessionLastTotalTokens('s2', DEFAULT_AGENT_COMPACT_TRIGGER_TOKENS)
    expect(
      shouldRunSdkCompactBeforeTurn({
        appSessionId: 's2',
        sdkSessionIdForResume: 'sdk',
        userPrompt: 'hi',
        config: { type: 'sliding_window' }
      })
    ).toBe(true)
    clearAgentSessionUsageCacheForTests()
  })

  it('returns false on /clear', () => {
    setAgentSessionLastTotalTokens('s3', 999999)
    expect(
      shouldRunSdkCompactBeforeTurn({
        appSessionId: 's3',
        sdkSessionIdForResume: 'sdk',
        userPrompt: '/clear',
        config: { type: 'sliding_window' }
      })
    ).toBe(false)
    clearAgentSessionUsageCacheForTests()
  })
})

describe('isAgentContextStrategyEnabled', () => {
  it('is false for none', () => {
    expect(isAgentContextStrategyEnabled({ type: 'none' })).toBe(false)
  })
})
