import ContextStrategySelector from '@renderer/components/ContextStrategySelector'
import type { ThemeMode } from '@renderer/types'
import type { ContextStrategyConfig } from '@renderer/types/contextStrategy'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDescription, SettingGroup, SettingTitle } from '..'

interface ChatContextPanelProps {
  theme?: ThemeMode
  strategy: ContextStrategyConfig
  onStrategyChange: (config: ContextStrategyConfig) => void
  title?: string
  description?: string
  showInheritOption?: boolean
  useInherited?: boolean
  onInheritedChange?: (useInherited: boolean) => void
  inheritedStrategyType?: ContextStrategyConfig['type']
  inheritLabel?: string
}

const ChatContextPanel: FC<ChatContextPanelProps> = ({
  theme,
  strategy,
  onStrategyChange,
  title,
  description,
  showInheritOption = false,
  useInherited = false,
  onInheritedChange,
  inheritedStrategyType,
  inheritLabel
}) => {
  const { t } = useTranslation()

  return (
    <SettingContainer theme={theme}>
      <SettingTitle>
        {title || t('settings.contextStrategy.title', { defaultValue: 'Chat Context Management' })}
      </SettingTitle>
      {description && <SettingDescription>{description}</SettingDescription>}
      <SettingGroup theme={theme}>
        <ContextStrategySelector
          value={strategy}
          onChange={onStrategyChange}
          showInheritOption={showInheritOption}
          useInherited={useInherited}
          onInheritedChange={onInheritedChange}
          inheritedStrategyType={inheritedStrategyType}
          inheritLabel={inheritLabel}
        />
      </SettingGroup>
    </SettingContainer>
  )
}

export default ChatContextPanel
