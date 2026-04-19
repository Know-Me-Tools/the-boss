import { loggerService } from '@logger'
import type { InstalledSkill, SkillConfigOverride, SkillGlobalConfig, SkillScopeConfigRow, SkillScopeRef } from '@types'
import { DEFAULT_SKILL_CONFIG, resolveSkillConfig, SkillScopeRefSchema } from '@types'

import { SkillRepository } from './SkillRepository'
import { SkillScopeRepository } from './SkillScopeRepository'

const logger = loggerService.withContext('SkillScopeService')
export const GLOBAL_SKILL_SCOPE: SkillScopeRef = { type: 'global', id: 'default' }

export class SkillScopeService {
  private static instance: SkillScopeService | null = null
  private readonly repository = SkillScopeRepository.getInstance()
  private readonly skillRepository = SkillRepository.getInstance()

  static getInstance(): SkillScopeService {
    if (!SkillScopeService.instance) {
      SkillScopeService.instance = new SkillScopeService()
    }
    return SkillScopeService.instance
  }

  async getConfig(scope: SkillScopeRef): Promise<SkillScopeConfigRow | null> {
    return this.repository.get(this.normalizeScope(scope))
  }

  async setConfig(scope: SkillScopeRef, config: SkillConfigOverride | null): Promise<SkillScopeConfigRow> {
    return this.repository.upsert(this.normalizeScope(scope), config)
  }

  async resolveConfig(
    scopes: SkillScopeRef | SkillScopeRef[],
    fallbackConfigs: Array<SkillConfigOverride | null | undefined> = []
  ): Promise<SkillGlobalConfig> {
    const inputScopes = this.normalizeScopes(scopes)
    const normalizedScopes = this.withGlobalScope(inputScopes)
    const fallbackByScope = new Map(inputScopes.map((scope, index) => [this.scopeKey(scope), fallbackConfigs[index]]))
    let config = resolveSkillConfig(DEFAULT_SKILL_CONFIG)

    for (const scope of normalizedScopes) {
      const row = await this.repository.get(scope)
      const override = row ? row.config : fallbackByScope.get(this.scopeKey(scope))
      if (override) {
        config = resolveSkillConfig(config, override)
      }
    }

    return config
  }

  async listSkillsForScope(
    scopes: SkillScopeRef | SkillScopeRef[],
    fallbackConfigs: Array<SkillConfigOverride | null | undefined> = []
  ): Promise<InstalledSkill[]> {
    const config = await this.resolveConfig(scopes, fallbackConfigs)
    const installedSkills = await this.skillRepository.list()

    if (config.selectedSkillIds?.length === 0) {
      return installedSkills.map((skill) => ({ ...skill, isEnabled: false }))
    }

    const selected = config.selectedSkillIds ? new Set(config.selectedSkillIds) : null
    return installedSkills.map((skill) => ({
      ...skill,
      isEnabled: selected ? selected.has(skill.id) : true
    }))
  }

  private normalizeScopes(scopes: SkillScopeRef | SkillScopeRef[]): SkillScopeRef[] {
    return (Array.isArray(scopes) ? scopes : [scopes]).map((scope) => this.normalizeScope(scope))
  }

  private normalizeScope(scope: SkillScopeRef): SkillScopeRef {
    const parsed = SkillScopeRefSchema.safeParse(scope)
    if (!parsed.success) {
      logger.warn('Invalid skill scope received', { scope, error: parsed.error.message })
      throw new Error('Invalid skill scope')
    }
    return parsed.data
  }

  private withGlobalScope(scopes: SkillScopeRef[]): SkillScopeRef[] {
    if (scopes.some((scope) => scope.type === GLOBAL_SKILL_SCOPE.type && scope.id === GLOBAL_SKILL_SCOPE.id)) {
      return scopes
    }
    return [GLOBAL_SKILL_SCOPE, ...scopes]
  }

  private scopeKey(scope: SkillScopeRef): string {
    return `${scope.type}:${scope.id}`
  }
}

export const skillScopeService = SkillScopeService.getInstance()
