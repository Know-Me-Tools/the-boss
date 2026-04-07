import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppSelector } from '@renderer/store'
import type { Assistant, AssistantSettings } from '@renderer/types'
import { type ContextStrategyConfig, DEFAULT_CONTEXT_STRATEGY_CONFIG } from '@renderer/types/contextStrategy'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  deriveContextStrategyOverride,
  hasContextStrategyOverride,
  resolveEffectiveChatContextStrategy
} from '../../../services/chatContextStrategy'
import ChatContextPanel from '../components/ChatContextPanel'

interface Props {
  assistant: Assistant
  updateAssistantSettings: (settings: Partial<AssistantSettings>) => void
}

const AssistantContextSettings: FC<Props> = ({ assistant, updateAssistantSettings }) => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const globalContextStrategy = useAppSelector(
    (state) => state.settings.contextStrategy || DEFAULT_CONTEXT_STRATEGY_CONFIG
  )

  const assistantContextOverride = assistant.settings?.contextStrategy
  const persistedInherited = !hasContextStrategyOverride(assistantContextOverride)
  const [useInherited, setUseInherited] = useState(persistedInherited)

  useEffect(() => {
    setUseInherited(persistedInherited)
  }, [persistedInherited])

  const effectiveStrategy = useMemo(
    () =>
      resolveEffectiveChatContextStrategy({
        globalStrategy: globalContextStrategy,
        assistant: assistantContextOverride
      }),
    [assistantContextOverride, globalContextStrategy]
  )

  const handleInheritedChange = (nextUseInherited: boolean) => {
    setUseInherited(nextUseInherited)

    if (nextUseInherited) {
      updateAssistantSettings({ contextStrategy: undefined })
    }
  }

  const handleStrategyChange = (nextStrategy: ContextStrategyConfig) => {
    const nextOverride = deriveContextStrategyOverride(globalContextStrategy, nextStrategy)
    updateAssistantSettings({ contextStrategy: nextOverride })
    setUseInherited(!nextOverride)
  }

  return (
    <ChatContextPanel
      theme={theme}
      strategy={effectiveStrategy}
      onStrategyChange={handleStrategyChange}
      showInheritOption
      useInherited={useInherited}
      onInheritedChange={handleInheritedChange}
      inheritedStrategyType={globalContextStrategy.type}
      inheritLabel={t('settings.contextStrategy.useGlobalDefault', { defaultValue: 'Use Global Default' })}
      title={t('settings.contextStrategy.title', { defaultValue: 'Chat Context Management' })}
      description={t('settings.contextStrategy.assistantDescription', {
        defaultValue: 'Use the global chat context strategy by default, or override it for this assistant.'
      })}
    />
  )
}

export default AssistantContextSettings
