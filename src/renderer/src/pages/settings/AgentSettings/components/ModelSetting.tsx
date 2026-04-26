import { HelpTooltip } from '@renderer/components/TooltipIcons'
import SelectAgentBaseModelButton from '@renderer/pages/agents/components/SelectAgentBaseModelButton'
import type { AgentBaseWithId, ApiModel, UpdateAgentFunctionUnion } from '@renderer/types'
import { buildRuntimeAwareModelUpdate } from '@renderer/utils/agentRuntimeModel'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsTitle } from '../shared'

export interface ModelSettingProps {
  base: AgentBaseWithId | undefined | null
  update: UpdateAgentFunctionUnion
  isDisabled?: boolean
}

export const ModelSetting = ({ base, update, isDisabled }: ModelSettingProps) => {
  const { t } = useTranslation()

  const updateModel = async (model: ApiModel) => {
    if (!base) return
    return update(buildRuntimeAwareModelUpdate({ base, selectedModel: model }))
  }

  if (!base) return null

  return (
    <SettingsItem inline>
      <SettingsTitle id="model" contentAfter={<HelpTooltip title={t('agent.add.model.tooltip')} />}>
        {t('common.model')}
      </SettingsTitle>
      <SelectAgentBaseModelButton
        agentBase={base}
        onSelect={async (model) => {
          await updateModel(model)
        }}
        isDisabled={isDisabled}
      />
    </SettingsItem>
  )
}
