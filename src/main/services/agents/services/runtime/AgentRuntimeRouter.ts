import { loggerService } from '@logger'
import { skillScopeService } from '@main/services/agents/skills/SkillScopeService'
import { installBuiltinSkills } from '@main/utils/builtinSkills'
import { AgentConfigurationSchema, type AgentRuntimeKind, type GetAgentSessionResponse } from '@types'

import type { AgentServiceInterface, AgentStream, AgentThinkingOptions } from '../../interfaces/AgentStreamInterface'
import { SkillRepository } from '../../skills/SkillRepository'
import { skillService } from '../../skills/SkillService'
import ClaudeCodeService from '../claudecode'
import { CodexRuntimeAdapter } from './CodexRuntimeAdapter'
import { OpenCodeRuntimeAdapter } from './OpenCodeRuntimeAdapter'
import type { AgentTurnInput } from './RuntimeContextBundle'
import { runtimeControlService } from './RuntimeControlService'
import { runtimeSkillBridgeService } from './RuntimeSkillBridgeService'
import { type AgentRuntimeCapabilities, DEFAULT_RUNTIME_CAPABILITIES, resolveRuntimeKind } from './types'
import { UarRuntimeAdapter } from './UarRuntimeAdapter'

const logger = loggerService.withContext('AgentRuntimeRouter')
const REQUIRED_PROMETHEUS_SKILL_SUFFIXES = [
  'prometheus-skill-system__skills__process__kbd-process-orchestrator',
  'prometheus-skill-system__skills__process__kbd-process-orchestrator__skills__kbd-execute',
  'prometheus-skill-system__skills__process__kbd-process-orchestrator__skills__kbd-reflect',
  'prometheus-skill-system__skills__process__iterative-evolver'
]

export class AgentRuntimeRouter implements AgentServiceInterface {
  private static builtinSkillInstallPromise: Promise<void> | null = null

  private readonly claude = new ClaudeCodeService()
  private readonly codex = new CodexRuntimeAdapter()
  private readonly opencode = new OpenCodeRuntimeAdapter()
  private readonly uar = new UarRuntimeAdapter()

  async invoke(
    prompt: AgentTurnInput,
    session: GetAgentSessionResponse,
    abortController: AbortController,
    lastAgentSessionId?: string,
    thinkingOptions?: AgentThinkingOptions,
    images?: Array<{ data: string; media_type: string }>
  ): Promise<AgentStream> {
    const effectiveSession = await this.withEffectiveRuntimeConfig(session)
    await this.preflightRuntimeSkills(effectiveSession)
    return this.getAdapter(resolveRuntimeKind(effectiveSession)).invoke(
      prompt,
      effectiveSession,
      abortController,
      lastAgentSessionId,
      thinkingOptions,
      images
    )
  }

  async compact(
    session: GetAgentSessionResponse,
    abortController: AbortController,
    lastAgentSessionId?: string,
    thinkingOptions?: AgentThinkingOptions
  ): Promise<AgentStream | null> {
    const effectiveSession = await this.withEffectiveRuntimeConfig(session)
    if (resolveRuntimeKind(effectiveSession) !== 'claude') {
      return null
    }
    await this.preflightRuntimeSkills(effectiveSession)
    return this.claude.invoke(
      '/compact',
      effectiveSession,
      abortController,
      lastAgentSessionId,
      thinkingOptions,
      undefined
    )
  }

  getCapabilities(kind: AgentRuntimeKind): AgentRuntimeCapabilities {
    switch (kind) {
      case 'claude':
        return {
          ...DEFAULT_RUNTIME_CAPABILITIES,
          tools: true,
          mcp: true,
          fileAccess: true,
          shellAccess: true,
          approvals: true,
          resume: true,
          compaction: true
        }
      case 'codex':
        return this.codex.capabilities
      case 'opencode':
        return this.opencode.capabilities
      case 'uar':
        return this.uar.capabilities
      default:
        return DEFAULT_RUNTIME_CAPABILITIES
    }
  }

  private getAdapter(kind: AgentRuntimeKind): AgentServiceInterface {
    switch (kind) {
      case 'claude':
        return this.claude
      case 'codex':
        return this.codex
      case 'opencode':
        return this.opencode
      case 'uar':
        return this.uar
      default:
        return this.claude
    }
  }

  private async withEffectiveRuntimeConfig(session: GetAgentSessionResponse): Promise<GetAgentSessionResponse> {
    const runtime = await runtimeControlService.resolveEffectiveRuntimeConfig(session)
    return {
      ...session,
      configuration: AgentConfigurationSchema.parse({
        ...session.configuration,
        runtime
      })
    }
  }

  private async preflightRuntimeSkills(session: GetAgentSessionResponse): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return
    }

    if (!AgentRuntimeRouter.builtinSkillInstallPromise) {
      AgentRuntimeRouter.builtinSkillInstallPromise = installBuiltinSkills()
    }
    await AgentRuntimeRouter.builtinSkillInstallPromise
    await this.ensureRequiredDefaultSkills()

    const cwd = session.accessible_paths[0]
    if (!cwd) {
      return
    }

    const runtimeKind = resolveRuntimeKind(session)

    try {
      await skillService.reconcileAgentSkills(session.agent_id, cwd)
      if (runtimeKind !== 'claude') {
        const scopedSkills = await skillScopeService.listSkillsForScope([
          { type: 'agent', id: session.agent_id },
          { type: 'session', id: session.id }
        ])
        await runtimeSkillBridgeService.syncRuntimeSkills({
          runtimeKind,
          cwd,
          agentId: session.agent_id,
          sessionId: session.id,
          skills: scopedSkills
        })
      }
    } catch (error) {
      logger.warn('Failed to reconcile agent runtime skills before session start', {
        agentId: session.agent_id,
        runtime: runtimeKind,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async ensureRequiredDefaultSkills(): Promise<void> {
    const skills = await SkillRepository.getInstance().list()
    const missingSkills = REQUIRED_PROMETHEUS_SKILL_SUFFIXES.filter(
      (folderName) => !skills.some((skill) => skill.folderName === folderName)
    )

    if (missingSkills.length > 0) {
      throw new Error(
        `Required Prometheus default skills are missing: ${missingSkills.join(', ')}. Initialize the prometheus-skill-system submodule and reconcile built-in skills before running agent execution.`
      )
    }

    for (const folderName of REQUIRED_PROMETHEUS_SKILL_SUFFIXES) {
      const skill = skills.find((item) => item.folderName === folderName)
      if (skill) {
        await skillService.enableForAllAgents(skill.id, skill.folderName)
      }
    }
  }
}
