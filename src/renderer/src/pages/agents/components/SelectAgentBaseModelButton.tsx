import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { SelectAgentModelPopup } from '@renderer/components/Popups/SelectModelPopup'
import { agentModelFilter } from '@renderer/config/models'
import { useApiModel } from '@renderer/hooks/agents/useModel'
import { getProviderNameById } from '@renderer/services/ProviderService'
import { type AgentBaseWithId, AgentConfigurationSchema, type AgentRuntimeConfig, type ApiModel } from '@renderer/types'
import { isAgentSessionEntity } from '@renderer/types'
import { isAgentEntity } from '@renderer/types'
import { getModelFilterByAgentType } from '@renderer/utils/agentSession'
import { apiModelAdapter } from '@renderer/utils/model'
import type { ButtonProps } from 'antd'
import { Button } from 'antd'
import { ChevronsUpDown } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  agentBase: AgentBaseWithId
  onSelect: (model: ApiModel) => Promise<void>
  isDisabled?: boolean
  /**
   * Effective runtime inherited from the parent agent when the session entity
   * does not yet carry its own `configuration.runtime`. Used as a fallback so
   * the correct model list and display name are shown immediately after a
   * runtime switch, before SWR revalidation propagates the change to the session.
   */
  effectiveRuntime?: AgentRuntimeConfig
  /** Custom className for the button */
  className?: string
  /** Custom inline styles for the button (merged with default styles) */
  buttonStyle?: CSSProperties
  /** Custom button size */
  buttonSize?: ButtonProps['size']
  /** Custom avatar size */
  avatarSize?: number
  /** Custom font size */
  fontSize?: number
  /** Custom icon size */
  iconSize?: number
  /** Custom className for the inner container (e.g., for justify-between) */
  containerClassName?: string
}

const SelectAgentBaseModelButton = ({
  agentBase: agent,
  onSelect,
  isDisabled,
  effectiveRuntime,
  className,
  buttonStyle,
  buttonSize = 'small',
  avatarSize = 20,
  fontSize = 12,
  iconSize = 14,
  containerClassName
}: Props) => {
  const { t } = useTranslation()
  const model = useApiModel({ id: agent?.model })

  // Prefer the runtime stored on the session; fall back to the one inherited
  // from the parent agent (passed via effectiveRuntime prop).
  const sessionRuntime = AgentConfigurationSchema.parse(agent?.configuration ?? {}).runtime
  const resolvedRuntime = sessionRuntime ?? effectiveRuntime

  const isCodexRuntime = resolvedRuntime?.kind === 'codex'
  const isOpenCodeRuntime = resolvedRuntime?.kind === 'opencode'

  const apiFilter = isAgentEntity(agent)
    ? getModelFilterByAgentType(agent.type)
    : isAgentSessionEntity(agent)
      ? getModelFilterByAgentType(agent.agent_type)
      : undefined

  if (!agent) return null

  const onSelectModel = async () => {
    if (isCodexRuntime) {
      // resolvedRuntime is non-null here (isCodexRuntime guard)
      const codexModels = await window.api.agentRuntime.listCodexModels(resolvedRuntime)
      const selectedModel = await SelectAgentModelPopup.show({
        model,
        models: codexModels
          .filter((item) => !item.hidden)
          .map(
            (item) =>
              ({
                id: item.id,
                object: 'model',
                created: 0,
                name: item.displayName || item.id,
                owned_by: 'Codex',
                provider: 'codex',
                provider_name: 'Codex',
                provider_model_id: item.model
              }) as ApiModel
          ),
        modelFilter: agentModelFilter
      })
      if (selectedModel && selectedModel.id !== agent.model) {
        void onSelect(selectedModel)
      }
      return
    }

    if (isOpenCodeRuntime) {
      // resolvedRuntime is non-null here (isOpenCodeRuntime guard)
      const openCodeModels = await window.api.agentRuntime.listOpenCodeModels(resolvedRuntime)
      const selectedModel = await SelectAgentModelPopup.show({
        model,
        models: openCodeModels
          .filter((item) => !item.hidden)
          .map(
            (item) =>
              ({
                id: item.id,
                object: 'model',
                created: 0,
                name: item.displayName || item.id,
                owned_by: item.providerName,
                provider: item.providerId,
                provider_name: item.providerName,
                provider_model_id: item.modelId
              }) as ApiModel
          ),
        modelFilter: agentModelFilter
      })
      if (selectedModel && selectedModel.id !== agent.model) {
        void onSelect(selectedModel)
      }
      return
    }

    const selectedModel = await SelectAgentModelPopup.show({
      model,
      apiFilter: apiFilter,
      modelFilter: agentModelFilter
    })
    if (selectedModel && selectedModel.id !== agent.model) {
      void onSelect(selectedModel)
    }
  }

  const providerName = model?.provider ? getProviderNameById(model.provider) : model?.provider_name

  // For Codex and OpenCode runtimes the model ID is not in the cherry-studio
  // provider list, so useApiModel returns undefined. Build fallback display
  // values directly from the runtime config.
  const runtimeModelId = resolvedRuntime?.modelId
  // OpenCode model IDs use "provider/model" format — split for display.
  const openCodeParts = isOpenCodeRuntime && runtimeModelId ? runtimeModelId.split('/') : null
  const openCodeDisplayName =
    openCodeParts && openCodeParts.length > 1 ? openCodeParts.slice(1).join('/') : runtimeModelId

  const displayModelName = isCodexRuntime
    ? (runtimeModelId ?? t('button.select_model'))
    : isOpenCodeRuntime
      ? (openCodeDisplayName ?? t('button.select_model'))
      : model
        ? model.name
        : t('button.select_model')

  const displayProviderName = isCodexRuntime
    ? 'Codex'
    : isOpenCodeRuntime
      ? (openCodeParts?.[0] ?? 'OpenCode')
      : providerName

  // Merge default styles with custom styles
  const mergedStyle: CSSProperties = {
    borderRadius: 20,
    fontSize,
    padding: 2,
    ...buttonStyle
  }

  const runtimeAvatarModel =
    (isCodexRuntime || isOpenCodeRuntime) && runtimeModelId
      ? apiModelAdapter({
          id: runtimeModelId,
          name: displayModelName,
          object: 'model',
          created: 0,
          owned_by: displayProviderName ?? '',
          provider: isCodexRuntime ? 'codex' : (openCodeParts?.[0] ?? 'opencode'),
          provider_name: displayProviderName ?? '',
          provider_model_id: runtimeModelId
        } as ApiModel)
      : undefined

  const avatarModel = runtimeAvatarModel ?? (model ? apiModelAdapter(model) : undefined)

  return (
    <Button
      size={buttonSize}
      type="text"
      className={className}
      style={mergedStyle}
      onClick={onSelectModel}
      disabled={isDisabled}>
      <div className={containerClassName || 'flex w-full items-center gap-1.5'}>
        <div className="flex flex-1 items-center gap-1.5 overflow-x-hidden">
          <ModelAvatar model={avatarModel} size={avatarSize} />
          <span className="truncate text-(--color-text)">
            {displayModelName} {displayProviderName ? ' | ' + displayProviderName : ''}
          </span>
        </div>
        <ChevronsUpDown size={iconSize} color="var(--color-icon)" />
      </div>
    </Button>
  )
}

export default SelectAgentBaseModelButton
