import {
  type AgentBaseWithId,
  AgentConfigurationSchema,
  type AgentRuntimeConfig,
  type ApiModel,
  type UpdateAgentBaseForm
} from '@renderer/types'

export function buildRuntimeAwareModelUpdate({
  base,
  selectedModel,
  effectiveRuntime
}: {
  base: AgentBaseWithId
  selectedModel: ApiModel
  effectiveRuntime?: AgentRuntimeConfig
}): UpdateAgentBaseForm {
  const configuration = AgentConfigurationSchema.parse(base.configuration ?? {})
  const runtime = configuration.runtime ?? effectiveRuntime

  if (runtime?.kind === 'codex' || runtime?.kind === 'opencode') {
    return {
      id: base.id,
      configuration: {
        ...configuration,
        runtime: {
          ...runtime,
          modelId: selectedModel.id
        }
      }
    }
  }

  return {
    id: base.id,
    model: selectedModel.id
  }
}
