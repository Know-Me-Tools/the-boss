import { loggerService } from '@logger'
import type { AgentRuntimeConfig, AgentRuntimeKind, GetAgentSessionResponse } from '@types'
import { AgentRuntimeConfigSchema } from '@types'

import { codexCliService, type CodexRuntimeModel } from './CodexCliService'
import { type ManagedRuntimeName, type ManagedRuntimeService, managedRuntimeService } from './ManagedRuntimeService'
import { openCodeCliService, type OpenCodeRuntimeModel } from './OpenCodeCliService'
import {
  type RuntimeBinaryDiscoveryResult,
  type RuntimeBinaryDiscoveryService,
  runtimeBinaryDiscoveryService,
  type RuntimeBinarySource
} from './RuntimeBinaryDiscoveryService'
import {
  RuntimeProfileRepository,
  type UpsertRuntimeProfileInput,
  type UpsertRuntimeSettingsInput
} from './RuntimeProfileRepository'
import { resolveRuntimeConfig } from './types'
import type { UarProviderRuntimeOptions, UarSidecarStatus } from './UniversalAgentRuntimeService'
import { universalAgentRuntimeService } from './UniversalAgentRuntimeService'

const logger = loggerService.withContext('RuntimeControlService')

export type RuntimeHealthState =
  | 'ready'
  | 'not-ready'
  | 'starting'
  | 'stopped'
  | 'missing-binary'
  | 'not-installed'
  | 'downloading'
  | 'verifying'
  | 'installed'
  | 'update-available'
  | 'verification-failed'
  | 'download-failed'
  | 'unreachable'
  | 'unsupported'
  | 'unsupported-platform'

export interface RuntimeHealthResult {
  kind: AgentRuntimeKind
  state: RuntimeHealthState
  endpoint?: string
  binaryPath?: string
  binarySource?: RuntimeBinarySource
  message: string
}

type RuntimeProfileRepositoryLike = Pick<
  RuntimeProfileRepository,
  'listProfiles' | 'getProfile' | 'getSettings' | 'upsertProfile' | 'upsertSettings'
>

type UniversalAgentRuntimeServiceLike = {
  ensureRunning(runtimeConfig: AgentRuntimeConfig, providerOptions?: UarProviderRuntimeOptions): Promise<string>
  getStatus(runtimeConfig: AgentRuntimeConfig): Promise<UarSidecarStatus>
  installManagedBinary(): Promise<UarSidecarStatus>
  stop(): Promise<void>
}

type CodexCliServiceLike = {
  resolveBinary(runtimeConfig?: AgentRuntimeConfig):
    | {
        state: 'ready' | 'missing-binary' | 'unsupported-platform'
        path?: string
        source?: RuntimeHealthResult['binarySource']
        message: string
      }
    | Promise<{
        state: 'ready' | 'missing-binary' | 'unsupported-platform'
        path?: string
        source?: RuntimeHealthResult['binarySource']
        message: string
      }>
  listModels(runtimeConfig?: AgentRuntimeConfig): Promise<CodexRuntimeModel[]>
}

type OpenCodeCliServiceLike = {
  resolveBinary(runtimeConfig?: AgentRuntimeConfig):
    | {
        state: 'ready' | 'missing-binary' | 'unsupported-platform'
        path?: string
        source?: RuntimeHealthResult['binarySource']
        message: string
      }
    | Promise<{
        state: 'ready' | 'missing-binary' | 'unsupported-platform'
        path?: string
        source?: RuntimeHealthResult['binarySource']
        message: string
      }>
  listModels(runtimeConfig?: AgentRuntimeConfig): Promise<OpenCodeRuntimeModel[]>
}

interface RuntimeControlServiceDependencies {
  runtimeProfileRepository?: RuntimeProfileRepositoryLike
  universalAgentRuntimeService?: UniversalAgentRuntimeServiceLike
  codexCliService?: CodexCliServiceLike
  openCodeCliService?: OpenCodeCliServiceLike
  managedRuntimeService?: ManagedRuntimeService
  runtimeBinaryDiscoveryService?: RuntimeBinaryDiscoveryService
}

export class RuntimeControlService {
  private readonly runtimeProfileRepository: RuntimeProfileRepositoryLike
  private readonly uarService: UniversalAgentRuntimeServiceLike
  private readonly codexService: CodexCliServiceLike
  private readonly openCodeService: OpenCodeCliServiceLike
  private readonly managedRuntimeService: ManagedRuntimeService
  private readonly runtimeBinaryDiscoveryService: RuntimeBinaryDiscoveryService

  constructor(dependencies: RuntimeControlServiceDependencies = {}) {
    this.runtimeProfileRepository = dependencies.runtimeProfileRepository ?? RuntimeProfileRepository.getInstance()
    this.uarService = dependencies.universalAgentRuntimeService ?? universalAgentRuntimeService
    this.codexService = dependencies.codexCliService ?? codexCliService
    this.openCodeService = dependencies.openCodeCliService ?? openCodeCliService
    this.managedRuntimeService = dependencies.managedRuntimeService ?? managedRuntimeService
    this.runtimeBinaryDiscoveryService = dependencies.runtimeBinaryDiscoveryService ?? runtimeBinaryDiscoveryService
  }

  listProfiles(kind?: AgentRuntimeKind) {
    return this.runtimeProfileRepository.listProfiles(kind)
  }

  getSettings(kind: AgentRuntimeKind) {
    return this.runtimeProfileRepository.getSettings(kind)
  }

  upsertProfile(input: UpsertRuntimeProfileInput) {
    return this.runtimeProfileRepository.upsertProfile(input)
  }

  upsertSettings(input: UpsertRuntimeSettingsInput) {
    return this.runtimeProfileRepository.upsertSettings(input)
  }

  listCodexModels(runtimeConfig?: AgentRuntimeConfig): Promise<CodexRuntimeModel[]> {
    return this.codexService.listModels(runtimeConfig)
  }

  listOpenCodeModels(runtimeConfig?: AgentRuntimeConfig): Promise<OpenCodeRuntimeModel[]> {
    return this.openCodeService.listModels(runtimeConfig)
  }

  discoverRuntimeBinary(kind: AgentRuntimeKind): Promise<RuntimeBinaryDiscoveryResult> {
    return this.runtimeBinaryDiscoveryService.discover(kind)
  }

  async resolveEffectiveRuntimeConfig(session: GetAgentSessionResponse): Promise<AgentRuntimeConfig> {
    const sessionRuntime = resolveRuntimeConfig(session)
    const kind = sessionRuntime.kind ?? 'claude'
    const settings = await this.runtimeProfileRepository.getSettings(kind)
    const profile = sessionRuntime.profileId
      ? await this.runtimeProfileRepository.getProfile(sessionRuntime.profileId)
      : null

    const baseRuntime = AgentRuntimeConfigSchema.parse({
      kind,
      mode: sessionRuntime.mode
    })
    const merged = mergeRuntimeConfig(
      baseRuntime,
      settings?.enabled === false ? undefined : settings?.config,
      profile?.kind === kind ? profile.config : undefined,
      sessionRuntime
    )

    return AgentRuntimeConfigSchema.parse(merged)
  }

  async testConnection(
    runtimeConfig: AgentRuntimeConfig,
    providerOptions?: UarProviderRuntimeOptions
  ): Promise<RuntimeHealthResult> {
    const config = AgentRuntimeConfigSchema.parse(runtimeConfig)

    if (config.kind === 'uar') {
      if (config.mode === 'embedded') {
        const before = await this.uarService.getStatus(config)
        if (before.state === 'missing-binary') {
          return mapUarStatus(before)
        }

        await this.uarService.ensureRunning(config, providerOptions)
      }

      return mapUarStatus(await this.uarService.getStatus(config))
    }

    if ((config.kind === 'opencode' || config.kind === 'codex') && config.mode === 'remote') {
      return this.testHttpEndpoint(config.kind, config.endpoint)
    }

    if (config.kind === 'codex') {
      const resolution = await this.codexService.resolveBinary(config)
      return {
        kind: 'codex',
        state: resolution.state,
        binaryPath: resolution.path,
        binarySource: resolution.source,
        message: resolution.message
      }
    }

    if (config.kind === 'opencode') {
      const resolution = await this.openCodeService.resolveBinary(config)
      return {
        kind: 'opencode',
        state: resolution.state,
        binaryPath: resolution.path,
        binarySource: resolution.source,
        message: resolution.message
      }
    }

    return {
      kind: config.kind,
      state: 'ready',
      message: `${config.kind} runtime configuration is ready.`
    }
  }

  async startSidecar(runtimeConfig: AgentRuntimeConfig, providerOptions?: UarProviderRuntimeOptions) {
    const config = AgentRuntimeConfigSchema.parse(runtimeConfig)
    if (config.kind !== 'uar' || config.mode !== 'embedded') {
      return {
        kind: config.kind,
        state: 'unsupported',
        message: 'Only embedded UAR has a managed sidecar.'
      } satisfies RuntimeHealthResult
    }

    await this.uarService.ensureRunning(config, providerOptions)
    return mapUarStatus(await this.uarService.getStatus(config))
  }

  async stopSidecar(): Promise<RuntimeHealthResult> {
    await this.uarService.stop()
    return {
      kind: 'uar',
      state: 'stopped',
      message: 'UAR embedded sidecar is stopped.'
    }
  }

  async getStatus(runtimeConfig: AgentRuntimeConfig): Promise<RuntimeHealthResult> {
    const config = AgentRuntimeConfigSchema.parse(runtimeConfig)
    if (config.kind === 'uar') {
      return mapUarStatus(await this.uarService.getStatus(config))
    }

    if ((config.kind === 'opencode' || config.kind === 'codex') && config.mode === 'remote') {
      return this.testHttpEndpoint(config.kind, config.endpoint)
    }

    if (config.kind === 'codex') {
      const resolution = await this.codexService.resolveBinary(config)
      return {
        kind: 'codex',
        state: resolution.state,
        binaryPath: resolution.path,
        binarySource: resolution.source,
        message: resolution.message
      }
    }

    if (config.kind === 'opencode' && config.mode !== 'remote') {
      const resolution = await this.openCodeService.resolveBinary(config)
      return {
        kind: 'opencode',
        state: resolution.state,
        binaryPath: resolution.path,
        binarySource: resolution.source,
        message: resolution.message
      }
    }

    return {
      kind: config.kind,
      state: 'ready',
      message: `${config.kind} runtime configuration is ready.`
    }
  }

  async installManagedBinary(request?: { name?: string }): Promise<RuntimeHealthResult> {
    const name = request?.name ?? 'universal-agent-runtime'
    if (!isManagedRuntimeName(name)) {
      return {
        kind: 'uar',
        state: 'unsupported',
        message: `Managed binary ${name} is not supported.`
      }
    }

    if (name === 'universal-agent-runtime') {
      return mapUarStatus(await this.uarService.installManagedBinary())
    }

    const status = await this.managedRuntimeService.install(name)
    return {
      kind: name === 'codex' ? 'codex' : 'opencode',
      state: status.state === 'missing' ? 'not-installed' : status.state,
      binaryPath: status.binaryPath,
      binarySource: 'managed',
      message: status.message
    }
  }

  async ensureRunnable(runtimeConfig: AgentRuntimeConfig): Promise<void> {
    const config = AgentRuntimeConfigSchema.parse(runtimeConfig)
    if (config.kind === 'claude') {
      return
    }

    const status = await this.getStatus(config)
    if (isRunnableRuntimeStatus(status)) {
      return
    }

    throw new Error(
      `Agent runtime is not ready for ${config.kind}. ${status.message} Open Agent Runtime Settings to download a managed runtime from IPFS or choose a local executable.`
    )
  }

  private async testHttpEndpoint(kind: AgentRuntimeKind, endpoint?: string): Promise<RuntimeHealthResult> {
    if (!endpoint) {
      return {
        kind,
        state: 'not-ready',
        message: `${kind} remote endpoint is not configured.`
      }
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const response = await fetch(new URL('/healthz', endpoint), { signal: controller.signal })
      clearTimeout(timeout)

      return {
        kind,
        state: response.ok ? 'ready' : 'not-ready',
        endpoint,
        message: response.ok
          ? `${kind} remote endpoint is ready.`
          : `${kind} remote endpoint returned status ${response.status}.`
      }
    } catch (error) {
      logger.warn('Runtime remote endpoint test failed', {
        runtime: kind,
        endpoint,
        error: error instanceof Error ? error.message : String(error)
      })
      return {
        kind,
        state: 'unreachable',
        endpoint,
        message: `${kind} remote endpoint is unreachable.`
      }
    }
  }
}

function mapUarStatus(status: UarSidecarStatus): RuntimeHealthResult {
  return {
    kind: status.kind,
    state: status.state,
    endpoint: status.endpoint,
    binaryPath: status.binaryPath,
    binarySource: status.binarySource,
    message: status.message
  }
}

function isRunnableRuntimeStatus(status: RuntimeHealthResult): boolean {
  if (status.kind === 'uar') {
    return status.state === 'ready' || status.state === 'stopped' || status.state === 'installed'
  }

  return status.state === 'ready'
}

function mergeRuntimeConfig(...configs: Array<Partial<AgentRuntimeConfig> | undefined>): Partial<AgentRuntimeConfig> {
  return configs.reduce<Partial<AgentRuntimeConfig>>((merged, config) => deepMerge(merged, config), {})
}

function deepMerge<T extends Record<string, unknown>>(target: T, source?: Partial<T>): T {
  if (!source) {
    return target
  }

  const next: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(source)) {
    const current = next[key]
    if (isPlainObject(current) && isPlainObject(value)) {
      next[key] = deepMerge(current, value)
    } else if (value !== undefined) {
      next[key] = value
    }
  }
  return next as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export const runtimeControlService = new RuntimeControlService()

function isManagedRuntimeName(value: string): value is ManagedRuntimeName {
  return value === 'universal-agent-runtime' || value === 'codex' || value === 'opencode'
}
