import type {
  AgentRuntimeConfig,
  AgentRuntimeKind,
  AgentRuntimeMode,
  AgentRuntimeProfile,
  UpdateAgentBaseForm
} from '@renderer/types'
import { AgentConfigurationSchema } from '@renderer/types'
import { Alert, Button, Input, Select, Switch, Tag } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AgentOrSessionSettingsProps,
  defaultConfiguration,
  SettingsContainer,
  SettingsItem,
  SettingsTitle
} from '../shared'

type RuntimeHealthState =
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

interface RuntimeHealthResult {
  kind: AgentRuntimeKind
  state: RuntimeHealthState
  endpoint?: string
  binarySource?: 'configured' | 'environment' | 'managed' | 'bundled'
  message: string
}

interface CodexRuntimeModel {
  id: string
  model: string
  displayName: string
  description?: string
  hidden: boolean
  isDefault: boolean
  supportedReasoningEfforts: string[]
  defaultReasoningEffort?: string
}

interface OpenCodeRuntimeModel {
  id: string
  providerId: string
  modelId: string
  displayName: string
  providerName: string
  hidden: boolean
  isDefault: boolean
  capabilities: Record<string, unknown>
  defaultAgent?: string
}

const capabilityLabels: Record<AgentRuntimeKind, string[]> = {
  claude: ['Tools', 'MCP', 'Skills', 'Knowledge', 'Files', 'Shell', 'Approvals', 'Resume', 'Compaction'],
  codex: ['Tools', 'MCP', 'Skills', 'Knowledge', 'Files', 'Shell', 'Approvals', 'Resume'],
  opencode: ['Tools', 'MCP', 'Skills', 'Knowledge', 'Files', 'Shell', 'Approvals', 'Resume'],
  uar: ['Tools', 'MCP', 'Skills', 'Knowledge', 'Files', 'Shell']
}

const RuntimeSettings: FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()
  const [runtimeProfiles, setRuntimeProfiles] = useState<AgentRuntimeProfile[]>([])
  const [healthMessage, setHealthMessage] = useState<{
    type: 'info' | 'success' | 'warning' | 'error'
    text: string
  } | null>(null)
  const [uarBinaryStatus, setUarBinaryStatus] = useState<RuntimeHealthResult | null>(null)
  const [codexModels, setCodexModels] = useState<CodexRuntimeModel[]>([])
  const [openCodeModels, setOpenCodeModels] = useState<OpenCodeRuntimeModel[]>([])
  const [isLoadingCodexModels, setIsLoadingCodexModels] = useState(false)
  const [isLoadingOpenCodeModels, setIsLoadingOpenCodeModels] = useState(false)
  const [isTestingHealth, setIsTestingHealth] = useState(false)
  const [isLoadingUarBinaryStatus, setIsLoadingUarBinaryStatus] = useState(false)
  const [isInstallingManagedBinary, setIsInstallingManagedBinary] = useState(false)
  const configuration = useMemo(
    () => AgentConfigurationSchema.parse(agentBase?.configuration ?? defaultConfiguration),
    [agentBase?.configuration]
  )
  const runtimeOptions = useMemo(
    () => [
      {
        value: 'claude' as const,
        label: t('agent.settings.runtime.options.claude.label', 'Claude'),
        description: t(
          'agent.settings.runtime.options.claude.description',
          'Native Anthropic-compatible Claude Agent SDK execution.'
        )
      },
      {
        value: 'codex' as const,
        label: t('agent.settings.runtime.options.codex.label', 'Codex'),
        description: t(
          'agent.settings.runtime.options.codex.description',
          'OpenAI Codex execution with workspace sandboxing and approvals.'
        )
      },
      {
        value: 'opencode' as const,
        label: t('agent.settings.runtime.options.opencode.label', 'OpenCode'),
        description: t(
          'agent.settings.runtime.options.opencode.description',
          'Managed or remote OpenCode server execution.'
        )
      },
      {
        value: 'uar' as const,
        label: t('agent.settings.runtime.options.uar.label', 'UAR'),
        description: t(
          'agent.settings.runtime.options.uar.description',
          'Embedded sidecar or remote Universal Agent Runtime execution.'
        )
      }
    ],
    [t]
  )
  const runtimeModes = useMemo<Record<AgentRuntimeKind, Array<{ value: AgentRuntimeMode; label: string }>>>(
    () => ({
      claude: [{ value: 'managed', label: t('agent.settings.runtime.modes.native', 'Native') }],
      codex: [{ value: 'managed', label: t('agent.settings.runtime.modes.managedSdk', 'Managed SDK') }],
      opencode: [
        { value: 'managed', label: t('agent.settings.runtime.modes.managedServer', 'Managed server') },
        { value: 'remote', label: t('agent.settings.runtime.modes.remoteUrl', 'Remote URL') }
      ],
      uar: [
        { value: 'embedded', label: t('agent.settings.runtime.modes.embeddedSidecar', 'Embedded sidecar') },
        { value: 'remote', label: t('agent.settings.runtime.modes.remoteUrl', 'Remote URL') }
      ]
    }),
    [t]
  )
  const runtime = useMemo(
    () => configuration.runtime ?? { kind: 'claude' as const, mode: 'managed' as const },
    [configuration.runtime]
  )
  const selectedKind = runtime.kind ?? 'claude'
  const selectedMode = runtime.mode ?? runtimeModes[selectedKind][0].value
  const sandbox = runtime.sandbox ?? {}
  const permissions = runtime.permissions ?? {}
  const sidecar = runtime.sidecar ?? {}
  const skills = runtime.skills ?? {}

  useEffect(() => {
    let disposed = false
    void window.api.agentRuntime
      .listProfiles(selectedKind)
      .then((profiles) => {
        if (!disposed) {
          setRuntimeProfiles(profiles)
        }
      })
      .catch((error) => {
        if (!disposed) {
          setRuntimeProfiles([])
          setHealthMessage({
            type: 'warning',
            text:
              error instanceof Error
                ? error.message
                : t('agent.settings.runtime.profileLoadFailed', 'Failed to load runtime profiles.')
          })
        }
      })

    return () => {
      disposed = true
    }
  }, [selectedKind, t])

  const loadCodexModels = useCallback(
    async (nextRuntime = runtime): Promise<CodexRuntimeModel[]> => {
      setIsLoadingCodexModels(true)
      try {
        const models = await window.api.agentRuntime.listCodexModels(nextRuntime)
        setCodexModels(models)
        return models
      } catch (error) {
        setCodexModels([])
        setHealthMessage({
          type: 'warning',
          text:
            error instanceof Error
              ? error.message
              : t('agent.settings.runtime.codex.modelLoadFailed', 'Failed to load Codex models.')
        })
        return []
      } finally {
        setIsLoadingCodexModels(false)
      }
    },
    [runtime, t]
  )

  const loadOpenCodeModels = useCallback(
    async (nextRuntime = runtime): Promise<OpenCodeRuntimeModel[]> => {
      setIsLoadingOpenCodeModels(true)
      try {
        const models = await window.api.agentRuntime.listOpenCodeModels(nextRuntime)
        setOpenCodeModels(models)
        return models
      } catch (error) {
        setOpenCodeModels([])
        setHealthMessage({
          type: 'warning',
          text:
            error instanceof Error
              ? error.message
              : t('agent.settings.runtime.opencode.modelLoadFailed', 'Failed to load OpenCode models.')
        })
        return []
      } finally {
        setIsLoadingOpenCodeModels(false)
      }
    },
    [runtime, t]
  )

  const refreshUarBinaryStatus = useCallback(async () => {
    if (selectedKind !== 'uar' || selectedMode !== 'embedded') {
      setUarBinaryStatus(null)
      return
    }

    setIsLoadingUarBinaryStatus(true)
    try {
      setUarBinaryStatus(await window.api.agentRuntime.getStatus(runtime))
    } catch (error) {
      setUarBinaryStatus({
        kind: 'uar',
        state: 'unreachable',
        message:
          error instanceof Error
            ? error.message
            : t('agent.settings.runtime.uar.binaryStatusLoadFailed', 'Failed to load UAR binary status.')
      })
    } finally {
      setIsLoadingUarBinaryStatus(false)
    }
  }, [runtime, selectedKind, selectedMode, t])

  useEffect(() => {
    void refreshUarBinaryStatus()
  }, [refreshUarBinaryStatus])

  const updateRuntime = useCallback(
    (patch: Record<string, unknown>) => {
      if (!agentBase) return
      const nextRuntime = {
        ...runtime,
        ...patch
      }
      void update(
        {
          id: agentBase.id,
          configuration: {
            ...configuration,
            runtime: nextRuntime
          }
        } satisfies UpdateAgentBaseForm,
        { showSuccessToast: false }
      )
    },
    [agentBase, configuration, runtime, update]
  )

  /**
   * Like updateRuntime but accepts a modelId parameter (ignored at the top-level
   * agent.model field to avoid Cherry's provider:model_id format validation
   * rejecting raw Codex/OpenCode model IDs). The model is persisted only in
   * configuration.runtime.modelId, which the display components already read.
   */
  const updateRuntimeWithModel = useCallback(
    (patch: Record<string, unknown>) => {
      if (!agentBase) return
      const nextRuntime = { ...runtime, ...patch }
      void update(
        {
          id: agentBase.id,
          configuration: {
            ...configuration,
            runtime: nextRuntime
          }
        } satisfies UpdateAgentBaseForm,
        { showSuccessToast: false }
      )
    },
    [agentBase, configuration, runtime, update]
  )

  const resolveCodexRuntimeDefaults = useCallback((nextRuntime: typeof runtime, models: CodexRuntimeModel[]) => {
    const visibleModels = models.filter((model) => !model.hidden)
    const candidates = visibleModels.length > 0 ? visibleModels : models
    const selectedModel = candidates.find((model) => model.id === nextRuntime.modelId)
    const defaultModel =
      candidates.find((model) => model.id === 'gpt-5.5') ?? candidates.find((model) => model.isDefault) ?? candidates[0]

    if (selectedModel) {
      return {
        modelId: selectedModel.id,
        reasoningEffort: (nextRuntime as any).reasoningEffort ?? selectedModel.defaultReasoningEffort
      }
    }

    return {
      modelId: defaultModel?.id,
      reasoningEffort: (nextRuntime as any).reasoningEffort ?? defaultModel?.defaultReasoningEffort
    }
  }, [])

  const resolveOpenCodeRuntimeDefaults = useCallback((nextRuntime: typeof runtime, models: OpenCodeRuntimeModel[]) => {
    const visibleModels = models.filter((model) => !model.hidden)
    const candidates = visibleModels.length > 0 ? visibleModels : models
    const selectedModel = candidates.find((model) => model.id === nextRuntime.modelId)
    const configuredModel = candidates.find((model) => model.id === (nextRuntime as any).model)
    const defaultModel = configuredModel ?? candidates.find((model) => model.isDefault) ?? candidates[0]

    if (selectedModel) {
      return {
        modelId: selectedModel.id,
        agentName: (nextRuntime as any).agentName ?? selectedModel.defaultAgent
      }
    }

    return {
      modelId: defaultModel?.id,
      agentName: (nextRuntime as any).agentName ?? defaultModel?.defaultAgent
    }
  }, [])

  useEffect(() => {
    if (selectedKind !== 'codex') {
      setCodexModels([])
      return
    }

    let disposed = false
    void loadCodexModels(runtime).then((models) => {
      if (disposed || models.length === 0) {
        return
      }

      const defaults = resolveCodexRuntimeDefaults(runtime, models)
      if (
        defaults.modelId &&
        (runtime.modelId !== defaults.modelId ||
          ((runtime as any).reasoningEffort === undefined && defaults.reasoningEffort !== undefined))
      ) {
        updateRuntimeWithModel(defaults)
      }
    })

    return () => {
      disposed = true
    }
  }, [loadCodexModels, resolveCodexRuntimeDefaults, runtime, selectedKind, updateRuntimeWithModel])

  useEffect(() => {
    if (selectedKind !== 'opencode') {
      setOpenCodeModels([])
      return
    }

    let disposed = false
    void loadOpenCodeModels(runtime).then((models) => {
      if (disposed || models.length === 0) {
        return
      }

      const defaults = resolveOpenCodeRuntimeDefaults(runtime, models)
      if (
        defaults.modelId &&
        (runtime.modelId !== defaults.modelId ||
          ((runtime as any).agentName === undefined && defaults.agentName !== undefined))
      ) {
        updateRuntimeWithModel(defaults)
      }
    })

    return () => {
      disposed = true
    }
  }, [loadOpenCodeModels, resolveOpenCodeRuntimeDefaults, runtime, selectedKind, updateRuntimeWithModel])

  const updateRuntimeGroup = useCallback(
    (group: 'sandbox' | 'permissions' | 'sidecar' | 'skills', patch: Record<string, unknown>) => {
      const current = runtime[group] ?? {}
      updateRuntime({
        [group]: {
          ...current,
          ...patch
        }
      })
    },
    [runtime, updateRuntime]
  )

  const updateConfiguration = useCallback(
    (patch: Record<string, unknown>) => {
      if (!agentBase) return
      void update(
        {
          id: agentBase.id,
          configuration: {
            ...configuration,
            ...patch
          }
        } satisfies UpdateAgentBaseForm,
        { showSuccessToast: false }
      )
    },
    [agentBase, configuration, update]
  )

  const testRuntimeConnection = useCallback(async () => {
    setIsTestingHealth(true)
    setHealthMessage({
      type: 'info',
      text: t('agent.settings.runtime.health.testing', 'Testing runtime connection...')
    })

    try {
      const result = await window.api.agentRuntime.testConnection(runtime)
      const type =
        result.state === 'ready'
          ? 'success'
          : result.state === 'missing-binary' || result.state === 'unreachable'
            ? 'error'
            : 'warning'
      setHealthMessage({
        type,
        text: result.message
      })
    } catch (error) {
      setHealthMessage({
        type: 'error',
        text: error instanceof Error ? error.message : t('agent.settings.runtime.health.failed', 'Runtime test failed.')
      })
    } finally {
      setIsTestingHealth(false)
    }
  }, [runtime, t])

  const installManagedBinary = useCallback(async () => {
    setIsInstallingManagedBinary(true)
    setUarBinaryStatus({
      kind: 'uar',
      state: 'downloading',
      message: t('agent.settings.runtime.uar.binaryDownloading', 'Downloading UAR managed binary...')
    })

    try {
      setUarBinaryStatus(await window.api.agentRuntime.installManagedBinary({ name: 'universal-agent-runtime' }))
    } catch (error) {
      setUarBinaryStatus({
        kind: 'uar',
        state: 'download-failed',
        message:
          error instanceof Error
            ? error.message
            : t('agent.settings.runtime.uar.binaryInstallFailed', 'Failed to install UAR managed binary.')
      })
    } finally {
      setIsInstallingManagedBinary(false)
    }
  }, [t])

  if (!agentBase) return null

  return (
    <SettingsContainer>
      <SettingsItem>
        <SettingsTitle>{t('agent.settings.runtime.title', 'Runtime')}</SettingsTitle>
        <div className="mt-2 flex flex-col gap-3">
          <Select
            aria-label={t('agent.settings.runtime.title', 'Runtime')}
            value={selectedKind}
            options={runtimeOptions.map((option) => ({ value: option.value, label: option.label }))}
            onChange={(kind: AgentRuntimeKind) => {
              const nextRuntime = {
                ...runtime,
                kind,
                mode: runtimeModes[kind][0].value
              } as AgentRuntimeConfig

              if (kind === 'codex') {
                void loadCodexModels(nextRuntime).then((models) => {
                  const defaults = resolveCodexRuntimeDefaults(nextRuntime, models)
                  updateRuntimeWithModel({ ...nextRuntime, ...defaults })
                })
                return
              }

              if (kind === 'opencode') {
                void loadOpenCodeModels(nextRuntime).then((models) => {
                  const defaults = resolveOpenCodeRuntimeDefaults(nextRuntime, models)
                  updateRuntimeWithModel({ ...nextRuntime, ...defaults })
                })
                return
              }

              updateRuntime(nextRuntime)
            }}
          />
          <span className="text-foreground-500 text-xs">
            {runtimeOptions.find((option) => option.value === selectedKind)?.description}
          </span>
        </div>
      </SettingsItem>
      <SettingsItem>
        <SettingsTitle>{t('agent.settings.runtime.mode', 'Mode')}</SettingsTitle>
        <div className="mt-2 flex flex-col gap-3">
          <Select
            aria-label={t('agent.settings.runtime.mode', 'Mode')}
            value={selectedMode}
            options={runtimeModes[selectedKind]}
            onChange={(mode: AgentRuntimeMode) => updateRuntime({ mode })}
          />
          {(selectedKind === 'opencode' || selectedKind === 'uar') && selectedMode === 'remote' && (
            <Input
              value={runtime.endpoint}
              onChange={(event) => updateRuntime({ endpoint: event.target.value })}
              placeholder="http://127.0.0.1:4096"
              aria-label={t('agent.settings.runtime.endpoint', 'Runtime endpoint')}
            />
          )}
        </div>
      </SettingsItem>
      <SettingsItem>
        <SettingsTitle>{t('agent.settings.runtime.profile', 'Runtime Profile')}</SettingsTitle>
        <Select
          aria-label={t('agent.settings.runtime.profile', 'Runtime Profile')}
          value={runtime.profileId ?? ''}
          options={[
            {
              value: '',
              label: t('agent.settings.runtime.profileDefault', 'Default profile')
            },
            ...runtimeProfiles.map((profile) => ({
              value: profile.id,
              label: profile.isDefault ? `${profile.name} (${t('common.default', 'Default')})` : profile.name
            }))
          ]}
          onChange={(profileId: string) => updateRuntime({ profileId: profileId || undefined })}
        />
      </SettingsItem>
      <SettingsItem>
        <SettingsTitle>{t('agent.settings.runtime.model', 'Model Override')}</SettingsTitle>
        {selectedKind === 'codex' ? (
          <Select
            value={runtime.modelId}
            loading={isLoadingCodexModels}
            aria-label={t('agent.settings.runtime.model', 'Model Override')}
            options={codexModels
              .filter((model) => !model.hidden)
              .map((model) => ({
                value: model.id,
                label: model.displayName || model.id
              }))}
            onChange={(modelId: string) => {
              const model = codexModels.find((item) => item.id === modelId)
              updateRuntimeWithModel({
                modelId,
                reasoningEffort: (runtime as any).reasoningEffort ?? model?.defaultReasoningEffort
              })
            }}
          />
        ) : selectedKind === 'opencode' ? (
          <Select
            value={runtime.modelId}
            loading={isLoadingOpenCodeModels}
            aria-label={t('agent.settings.runtime.model', 'Model Override')}
            options={openCodeModels
              .filter((model) => !model.hidden)
              .map((model) => ({
                value: model.id,
                label: `${model.providerName} / ${model.displayName || model.id}`
              }))}
            onChange={(modelId: string) => {
              const model = openCodeModels.find((item) => item.id === modelId)
              updateRuntimeWithModel({ modelId, agentName: (runtime as any).agentName ?? model?.defaultAgent })
            }}
          />
        ) : (
          <Input
            value={runtime.modelId}
            onChange={(event) => updateRuntime({ modelId: event.target.value || undefined })}
            placeholder={agentBase.model}
            aria-label={t('agent.settings.runtime.model', 'Model Override')}
          />
        )}
      </SettingsItem>
      {selectedKind === 'claude' && (
        <SettingsItem>
          <SettingsTitle>{t('agent.settings.runtime.claude.title', 'Claude runtime')}</SettingsTitle>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Select
              aria-label={t('agent.settings.runtime.claude.permissionMode', 'Permission mode')}
              value={configuration.permission_mode}
              options={[
                { value: 'default', label: t('agent.settings.tooling.permissionMode.default.title', 'Normal Mode') },
                {
                  value: 'acceptEdits',
                  label: t('agent.settings.tooling.permissionMode.acceptEdits.title', 'Auto-edit Mode')
                },
                {
                  value: 'bypassPermissions',
                  label: t('agent.settings.tooling.permissionMode.bypassPermissions.title', 'Full Auto Mode')
                },
                { value: 'plan', label: t('agent.settings.tooling.permissionMode.plan.title', 'Plan Mode') }
              ]}
              onChange={(permissionMode) => updateConfiguration({ permission_mode: permissionMode })}
            />
            <Input
              aria-label={t('agent.settings.runtime.claude.maxTurns', 'Max turns')}
              value={configuration.max_turns}
              onChange={(event) => updateConfiguration({ max_turns: Number(event.target.value) || 1 })}
            />
          </div>
        </SettingsItem>
      )}
      {selectedKind === 'codex' && (
        <SettingsItem>
          <SettingsTitle>{t('agent.settings.runtime.codex.title', 'Codex runtime')}</SettingsTitle>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Select
              aria-label={t('agent.settings.runtime.codex.sandboxMode', 'Sandbox mode')}
              value={(sandbox.mode as string) ?? 'workspace-write'}
              options={[
                { value: 'read-only', label: t('agent.settings.runtime.codex.sandbox.readOnly', 'Read only') },
                {
                  value: 'workspace-write',
                  label: t('agent.settings.runtime.codex.sandbox.workspaceWrite', 'Workspace write')
                },
                {
                  value: 'danger-full-access',
                  label: t('agent.settings.runtime.codex.sandbox.fullAccess', 'Full access')
                }
              ]}
              onChange={(mode) => updateRuntimeGroup('sandbox', { mode })}
            />
            <Select
              aria-label={t('agent.settings.runtime.codex.approvalPolicy', 'Approval policy')}
              value={(permissions.mode as string) ?? 'on-request'}
              options={[
                { value: 'never', label: t('agent.settings.runtime.approvals.never', 'Never') },
                { value: 'on-request', label: t('agent.settings.runtime.approvals.onRequest', 'On request') },
                { value: 'on-failure', label: t('agent.settings.runtime.approvals.onFailure', 'On failure') },
                { value: 'untrusted', label: t('agent.settings.runtime.approvals.untrusted', 'Untrusted only') }
              ]}
              onChange={(mode) => updateRuntimeGroup('permissions', { mode })}
            />
            <Switch
              aria-label={t('agent.settings.runtime.codex.networkAccess', 'Network access')}
              checked={Boolean(sandbox.networkAccess)}
              onChange={(networkAccess) => updateRuntimeGroup('sandbox', { networkAccess })}
            />
            <Select
              aria-label={t('agent.settings.runtime.codex.reasoningEffort', 'Reasoning effort')}
              value={(runtime.reasoningEffort as string) ?? 'medium'}
              options={[
                { value: 'low', label: t('agent.settings.runtime.reasoning.low', 'Low') },
                { value: 'medium', label: t('agent.settings.runtime.reasoning.medium', 'Medium') },
                { value: 'high', label: t('agent.settings.runtime.reasoning.high', 'High') },
                { value: 'xhigh', label: t('agent.settings.runtime.reasoning.xhigh', 'Extra high') }
              ]}
              onChange={(reasoningEffort) => updateRuntime({ reasoningEffort })}
            />
          </div>
        </SettingsItem>
      )}
      {selectedKind === 'opencode' && (
        <SettingsItem>
          <SettingsTitle>{t('agent.settings.runtime.opencode.title', 'OpenCode runtime')}</SettingsTitle>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              aria-label={t('agent.settings.runtime.opencode.agentName', 'Agent name')}
              value={runtime.agentName as string}
              onChange={(event) => updateRuntime({ agentName: event.target.value || undefined })}
            />
            <Select
              aria-label={t('agent.settings.runtime.opencode.permissionPolicy', 'Permission policy')}
              value={(permissions.mode as string) ?? 'ask'}
              options={[
                { value: 'ask', label: t('agent.settings.runtime.approvals.onRequest', 'On request') },
                { value: 'allow', label: t('agent.settings.runtime.approvals.allow', 'Allow') },
                { value: 'deny', label: t('agent.settings.runtime.approvals.deny', 'Deny') }
              ]}
              onChange={(mode) => updateRuntimeGroup('permissions', { mode })}
            />
            <Switch
              aria-label={t('agent.settings.runtime.opencode.skillTool', 'Skill tool')}
              checked={skills.toolEnabled !== false}
              onChange={(toolEnabled) => updateRuntimeGroup('skills', { toolEnabled })}
            />
          </div>
        </SettingsItem>
      )}
      {selectedKind === 'uar' && (
        <SettingsItem>
          <SettingsTitle>{t('agent.settings.runtime.uar.title', 'Universal Agent Runtime')}</SettingsTitle>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              aria-label={t('agent.settings.runtime.uar.sidecarPort', 'Sidecar port')}
              value={sidecar.port as number | string | undefined}
              onChange={(event) => updateRuntimeGroup('sidecar', { port: Number(event.target.value) || undefined })}
              placeholder="1906"
            />
            <Input
              aria-label={t('agent.settings.runtime.uar.binaryPath', 'Binary path')}
              value={sidecar.binaryPath as string}
              onChange={(event) => updateRuntimeGroup('sidecar', { binaryPath: event.target.value || undefined })}
            />
            <Input
              aria-label={t('agent.settings.runtime.uar.dataDir', 'Data directory')}
              value={sidecar.dataDir as string}
              onChange={(event) => updateRuntimeGroup('sidecar', { dataDir: event.target.value || undefined })}
            />
            <Input
              aria-label={t('agent.settings.runtime.uar.remoteUrl', 'Remote URL')}
              value={runtime.endpoint}
              onChange={(event) => updateRuntime({ endpoint: event.target.value || undefined })}
              placeholder="http://127.0.0.1:1906"
            />
            <Input
              aria-label={t('agent.settings.runtime.uar.authRef', 'Auth reference')}
              value={runtime.authRef}
              onChange={(event) => updateRuntime({ authRef: event.target.value || undefined })}
            />
            <Select
              aria-label={t('agent.settings.runtime.uar.logLevel', 'Log level')}
              value={(sidecar.logLevel as string) ?? 'info'}
              options={[
                { value: 'error', label: t('agent.settings.runtime.log.error', 'Error') },
                { value: 'warn', label: t('agent.settings.runtime.log.warn', 'Warn') },
                { value: 'info', label: t('agent.settings.runtime.log.info', 'Info') },
                { value: 'debug', label: t('agent.settings.runtime.log.debug', 'Debug') }
              ]}
              onChange={(logLevel) => updateRuntimeGroup('sidecar', { logLevel })}
            />
            <Switch
              aria-label={t('agent.settings.runtime.uar.skillSync', 'Skill sync')}
              checked={skills.syncEnabled !== false}
              onChange={(syncEnabled) => updateRuntimeGroup('skills', { syncEnabled })}
            />
          </div>
          {selectedMode === 'embedded' && (
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Tag>{getRuntimeStateLabel(uarBinaryStatus?.state ?? 'not-ready', t)}</Tag>
                {uarBinaryStatus?.binarySource && <Tag>{getBinarySourceLabel(uarBinaryStatus.binarySource, t)}</Tag>}
              </div>
              <Alert
                type={getRuntimeHealthAlertType(uarBinaryStatus?.state)}
                showIcon
                message={
                  uarBinaryStatus?.message ??
                  t('agent.settings.runtime.uar.binaryStatusUnknown', 'UAR binary status has not been checked.')
                }
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  loading={isLoadingUarBinaryStatus}
                  onClick={() => {
                    void refreshUarBinaryStatus()
                  }}>
                  {t('agent.settings.runtime.uar.refreshBinaryStatus', 'Refresh status')}
                </Button>
                <Button
                  loading={isInstallingManagedBinary}
                  disabled={!canInstallManagedBinary(uarBinaryStatus?.state)}
                  onClick={() => {
                    void installManagedBinary()
                  }}>
                  {t('agent.settings.runtime.uar.installManagedBinary', 'Install/update')}
                </Button>
              </div>
            </div>
          )}
          <div className="mt-2 text-xs">{t('agent.settings.runtime.uar.skillSync', 'Skill sync')}</div>
        </SettingsItem>
      )}
      <SettingsItem>
        <SettingsTitle>{t('agent.settings.runtime.health.title', 'Runtime health')}</SettingsTitle>
        <Button
          loading={isTestingHealth}
          onClick={() => {
            void testRuntimeConnection()
          }}>
          {t('agent.settings.runtime.health.test', 'Test connection')}
        </Button>
        {healthMessage && <Alert className="mt-3" type={healthMessage.type} showIcon message={healthMessage.text} />}
      </SettingsItem>
      <SettingsItem divider={false}>
        <SettingsTitle>{t('agent.settings.runtime.capabilities', 'Capabilities')}</SettingsTitle>
        <div className="mt-2 flex flex-wrap gap-2">
          {capabilityLabels[selectedKind].map((label) => (
            <Tag key={label}>{label}</Tag>
          ))}
        </div>
        {selectedKind === 'claude' && (
          <Alert
            className="mt-3"
            type="info"
            showIcon
            message={t(
              'agent.settings.runtime.claudeProviderNotice',
              'Claude runtime uses native Anthropic-compatible providers only. Use Codex for OpenAI models and OpenCode for broader provider routing.'
            )}
          />
        )}
      </SettingsItem>
    </SettingsContainer>
  )
}

export default RuntimeSettings

function getRuntimeHealthAlertType(state?: RuntimeHealthState): 'info' | 'success' | 'warning' | 'error' {
  if (state === 'ready' || state === 'installed' || state === 'stopped') {
    return 'success'
  }
  if (
    state === 'missing-binary' ||
    state === 'not-installed' ||
    state === 'verification-failed' ||
    state === 'download-failed' ||
    state === 'unreachable' ||
    state === 'unsupported' ||
    state === 'unsupported-platform'
  ) {
    return 'error'
  }
  if (state === 'downloading' || state === 'verifying' || state === 'starting') {
    return 'info'
  }
  return 'warning'
}

function canInstallManagedBinary(state?: RuntimeHealthState): boolean {
  return (
    state === 'not-installed' ||
    state === 'download-failed' ||
    state === 'verification-failed' ||
    state === 'update-available'
  )
}

function getRuntimeStateLabel(state: RuntimeHealthState, t: ReturnType<typeof useTranslation>['t']): string {
  const labels: Record<RuntimeHealthState, string> = {
    ready: t('agent.settings.runtime.status.ready', 'Ready'),
    'not-ready': t('agent.settings.runtime.status.notReady', 'Not ready'),
    starting: t('agent.settings.runtime.status.starting', 'Starting'),
    stopped: t('agent.settings.runtime.status.stopped', 'Stopped'),
    'missing-binary': t('agent.settings.runtime.status.missingBinary', 'Missing binary'),
    'not-installed': t('agent.settings.runtime.status.notInstalled', 'Not installed'),
    downloading: t('agent.settings.runtime.status.downloading', 'Downloading'),
    verifying: t('agent.settings.runtime.status.verifying', 'Verifying'),
    installed: t('agent.settings.runtime.status.installed', 'Installed'),
    'update-available': t('agent.settings.runtime.status.updateAvailable', 'Update available'),
    'verification-failed': t('agent.settings.runtime.status.verificationFailed', 'Verification failed'),
    'download-failed': t('agent.settings.runtime.status.downloadFailed', 'Download failed'),
    unreachable: t('agent.settings.runtime.status.unreachable', 'Unreachable'),
    unsupported: t('agent.settings.runtime.status.unsupported', 'Unsupported'),
    'unsupported-platform': t('agent.settings.runtime.status.unsupportedPlatform', 'Unsupported platform')
  }
  return labels[state]
}

function getBinarySourceLabel(
  source: NonNullable<RuntimeHealthResult['binarySource']>,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const labels: Record<NonNullable<RuntimeHealthResult['binarySource']>, string> = {
    configured: t('agent.settings.runtime.uar.binarySource.configured', 'Configured path'),
    environment: t('agent.settings.runtime.uar.binarySource.environment', 'Environment path'),
    managed: t('agent.settings.runtime.uar.binarySource.managed', 'Managed binary'),
    bundled: t('agent.settings.runtime.uar.binarySource.bundled', 'Bundled fallback')
  }
  return labels[source]
}
