import type { ContextStrategyConfig } from '@types'

import { DEFAULT_AGENT_COMPACT_TRIGGER_TOKENS, isAgentContextStrategyEnabled } from './configResolver'
import { getAgentSessionLastTotalTokens } from './usageCache'

/**
 * Whether to run an SDK `/compact` turn before the user's message (resume sessions only).
 */
export function shouldRunSdkCompactBeforeTurn(options: {
  appSessionId: string
  sdkSessionIdForResume: string | undefined
  userPrompt: string
  config: ContextStrategyConfig
}): boolean {
  const { appSessionId, sdkSessionIdForResume, userPrompt, config } = options
  if (!isAgentContextStrategyEnabled(config)) {
    return false
  }
  if (!sdkSessionIdForResume) {
    return false
  }
  if (userPrompt.includes('/clear')) {
    return false
  }
  const threshold = config.compactTriggerTokens ?? DEFAULT_AGENT_COMPACT_TRIGGER_TOKENS
  const last = getAgentSessionLastTotalTokens(appSessionId)
  if (last === undefined) {
    return false
  }
  return last >= threshold
}
