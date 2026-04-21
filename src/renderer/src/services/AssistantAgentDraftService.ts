import { getModelUniqId } from '@renderer/services/ModelService'
import {
  type AddAgentForm,
  AgentConfigurationSchema,
  type Assistant,
  type SkillConfigOverride,
  type SkillGlobalConfig,
  type Topic
} from '@renderer/types'

interface BuildAgentDraftFromAssistantOptions {
  assistant: Assistant
  topic?: Topic | null
  skillConfig?: SkillConfigOverride | SkillGlobalConfig | null
}

export function buildAgentDraftFromAssistant({
  assistant,
  topic,
  skillConfig
}: BuildAgentDraftFromAssistantOptions): AddAgentForm {
  const model = getModelUniqId(assistant.model || assistant.defaultModel)

  return {
    type: 'claude-code',
    name: assistant.name,
    description: assistant.description,
    instructions: assistant.prompt,
    model,
    accessible_paths: [],
    allowed_tools: [],
    mcps: assistant.mcpServers?.map((server) => server.id) ?? [],
    knowledge_bases: assistant.knowledge_bases,
    knowledgeRecognition: assistant.knowledgeRecognition ?? 'off',
    configuration: AgentConfigurationSchema.parse({
      skill_config: skillConfig ?? undefined,
      origin: {
        type: 'assistant',
        assistantId: assistant.id,
        topicId: topic?.id
      }
    })
  }
}
