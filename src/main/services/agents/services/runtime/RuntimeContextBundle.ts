import type { GetAgentSessionResponse, KnowledgeReference } from '@types'

import type { PreparedSkillContext } from '../../../skills/buildSkillStreamParts'
import { resolveRuntimeCompatibility, resolveRuntimeConfig, type RuntimeCompatibilityResult } from './types'

export interface RuntimeContextBundle {
  type: 'prepared-agent-turn'
  prompt: string
  originalPrompt: string
  session: {
    id: string
    agentId: string
    name: string
  }
  runtime: {
    config: ReturnType<typeof resolveRuntimeConfig>
    compatibility: RuntimeCompatibilityResult
  }
  model: {
    id: string
  }
  workspace: {
    cwd?: string
    accessiblePaths: string[]
  }
  context: {
    skills: PreparedSkillContext[]
    knowledgeReferences: KnowledgeReference[]
  }
  attachments: {
    images: Array<{ data: string; media_type: string }>
  }
}

export type AgentTurnInput = string | RuntimeContextBundle

export function createRuntimeContextBundle(params: {
  session: GetAgentSessionResponse
  prompt: string
  originalPrompt: string
  skills?: PreparedSkillContext[]
  knowledgeReferences?: KnowledgeReference[]
  images?: Array<{ data: string; media_type: string }>
}): RuntimeContextBundle {
  const runtimeConfig = resolveRuntimeConfig(params.session)

  return {
    type: 'prepared-agent-turn',
    prompt: params.prompt,
    originalPrompt: params.originalPrompt,
    session: {
      id: params.session.id,
      agentId: params.session.agent_id,
      name: params.session.name ?? params.session.id
    },
    runtime: {
      config: runtimeConfig,
      compatibility: resolveRuntimeCompatibility(params.session)
    },
    model: {
      id: params.session.configuration?.runtime?.modelId ?? params.session.model
    },
    workspace: {
      cwd: params.session.accessible_paths[0],
      accessiblePaths: params.session.accessible_paths
    },
    context: {
      skills: params.skills ?? [],
      knowledgeReferences: params.knowledgeReferences ?? []
    },
    attachments: {
      images: params.images ?? []
    }
  }
}

export function resolveAgentTurnInput(input: AgentTurnInput): RuntimeContextBundle | null {
  return typeof input === 'string' ? null : input
}

export function getPromptText(input: AgentTurnInput): string {
  return typeof input === 'string' ? input : input.prompt
}
