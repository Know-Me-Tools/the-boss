import type { AgentRuntimeConfig, AgentRuntimeKind, GetAgentSessionResponse } from '@types'

export type RuntimeCapabilityKey =
  | 'tools'
  | 'mcp'
  | 'skills'
  | 'knowledge'
  | 'fileAccess'
  | 'shellAccess'
  | 'approvals'
  | 'resume'
  | 'compaction'

export type AgentRuntimeCapabilities = Record<RuntimeCapabilityKey, boolean>

export const DEFAULT_RUNTIME_CAPABILITIES: AgentRuntimeCapabilities = {
  tools: false,
  mcp: false,
  skills: true,
  knowledge: true,
  fileAccess: false,
  shellAccess: false,
  approvals: false,
  resume: false,
  compaction: false
}

export const RUNTIME_CAPABILITY_MATRIX: Record<AgentRuntimeKind, AgentRuntimeCapabilities> = {
  claude: {
    tools: true,
    mcp: true,
    skills: true,
    knowledge: true,
    fileAccess: true,
    shellAccess: true,
    approvals: true,
    resume: true,
    compaction: true
  },
  codex: {
    tools: true,
    mcp: true,
    skills: true,
    knowledge: true,
    fileAccess: true,
    shellAccess: true,
    approvals: true,
    resume: true,
    compaction: false
  },
  opencode: {
    tools: true,
    mcp: true,
    skills: true,
    knowledge: true,
    fileAccess: true,
    shellAccess: true,
    approvals: true,
    resume: true,
    compaction: false
  },
  uar: {
    tools: true,
    mcp: true,
    skills: true,
    knowledge: true,
    fileAccess: true,
    shellAccess: true,
    approvals: false,
    resume: false,
    compaction: false
  }
}

export type RuntimeCompatibilityIssue = {
  code: string
  message: string
  capability: RuntimeCapabilityKey
}

export type RuntimeCompatibilityResult = {
  kind: AgentRuntimeKind
  capabilities: AgentRuntimeCapabilities
  compatible: boolean
  warnings: RuntimeCompatibilityIssue[]
  blockingIssues: RuntimeCompatibilityIssue[]
}

export function resolveRuntimeConfig(session: GetAgentSessionResponse): AgentRuntimeConfig {
  return {
    kind: 'claude',
    mode: 'managed',
    ...session.configuration?.runtime
  }
}

export function resolveRuntimeKind(session: GetAgentSessionResponse): AgentRuntimeKind {
  return resolveRuntimeConfig(session).kind ?? 'claude'
}

export function resolveRuntimeCompatibility(session: GetAgentSessionResponse): RuntimeCompatibilityResult {
  const kind = resolveRuntimeKind(session)
  const capabilities = RUNTIME_CAPABILITY_MATRIX[kind] ?? DEFAULT_RUNTIME_CAPABILITIES
  const required = getRequiredRuntimeCapabilities(session)
  const warnings = required
    .filter((capability) => !capabilities[capability])
    .map((capability) => ({
      code: `runtime.${capability}.unsupported`,
      message: `The selected ${kind} runtime does not natively support ${capability}.`,
      capability
    }))

  return {
    kind,
    capabilities,
    compatible: true,
    warnings,
    blockingIssues: []
  }
}

function getRequiredRuntimeCapabilities(session: GetAgentSessionResponse): RuntimeCapabilityKey[] {
  const required = new Set<RuntimeCapabilityKey>()

  if (session.allowed_tools?.length) {
    required.add('tools')
  }
  if (session.mcps?.length) {
    required.add('mcp')
  }
  if (session.knowledgeRecognition === 'on' && session.knowledge_bases?.length) {
    required.add('knowledge')
  }
  if (session.accessible_paths?.length) {
    required.add('fileAccess')
  }
  if (session.configuration?.permission_mode && session.configuration.permission_mode !== 'bypassPermissions') {
    required.add('approvals')
  }
  if (session.configuration?.context_strategy) {
    required.add('compaction')
  }
  if (session.configuration?.skill_config) {
    required.add('skills')
  }

  return Array.from(required)
}
