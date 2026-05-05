import type { AgentRuntimeConfig, AgentRuntimeKind, AgentRuntimeMode, AgentRuntimeSettings } from '@renderer/types'
import type { DependencyStatus, ManagedDependencyName } from '@shared/config/types'
import { Alert, Button, Input, Tag } from 'antd'
import { Download, FolderOpen, RefreshCcw, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { SettingsContainer, SettingsItem, SettingsTitle } from './AgentSettings/shared'

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
  binaryPath?: string
  binarySource?: RuntimeBinarySource
  message: string
}

type RuntimeBinarySource = 'configured' | 'environment' | 'path' | 'managed' | 'development'

interface RuntimeBinaryDiscoveryResult {
  kind: AgentRuntimeKind
  command: string
  detectedPath?: string
  version?: string
  source: 'path'
  available: boolean
  message: string
}

type ManagedRuntimeInstallName = 'universal-agent-runtime' | 'codex' | 'opencode'

interface RuntimeRow {
  kind: AgentRuntimeKind
  mode: AgentRuntimeMode
  managedName?: ManagedRuntimeInstallName
  title: string
  description: string
  editable: boolean
}

const RUST_TOOLCHAIN_DEPENDENCIES: ManagedDependencyName[] = ['rustup', 'cargo', 'rustc', 'wasm32-unknown-unknown']

const AgentRuntimeSettings: FC = () => {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const selectedRuntime = searchParams.get('runtime')
  const [settings, setSettings] = useState<Partial<Record<AgentRuntimeKind, AgentRuntimeSettings | null>>>({})
  const [statuses, setStatuses] = useState<Partial<Record<AgentRuntimeKind, RuntimeHealthResult>>>({})
  const [discoveries, setDiscoveries] = useState<Partial<Record<AgentRuntimeKind, RuntimeBinaryDiscoveryResult>>>({})
  const [loadingRuntime, setLoadingRuntime] = useState<AgentRuntimeKind | null>(null)
  const [loadingDiscovery, setLoadingDiscovery] = useState<AgentRuntimeKind | null>(null)
  const [installingRuntime, setInstallingRuntime] = useState<AgentRuntimeKind | null>(null)
  const [rustToolchainStatus, setRustToolchainStatus] = useState<DependencyStatus[]>([])
  const [isLoadingRustToolchainStatus, setIsLoadingRustToolchainStatus] = useState(false)
  const [isInstallingRustToolchain, setIsInstallingRustToolchain] = useState(false)

  const runtimes = useMemo<RuntimeRow[]>(
    () => [
      {
        kind: 'claude',
        mode: 'managed',
        title: t('settings.agentRuntimes.claude.title', 'Claude Code'),
        description: t(
          'settings.agentRuntimes.claude.description',
          'Current working Claude Code implementation. It remains unchanged and is used as the behavior reference.'
        ),
        editable: false
      },
      {
        kind: 'codex',
        mode: 'managed',
        managedName: 'codex',
        title: t('settings.agentRuntimes.codex.title', 'Codex'),
        description: t('settings.agentRuntimes.codex.description', 'Managed Codex CLI runtime.'),
        editable: true
      },
      {
        kind: 'opencode',
        mode: 'managed',
        managedName: 'opencode',
        title: t('settings.agentRuntimes.opencode.title', 'OpenCode'),
        description: t('settings.agentRuntimes.opencode.description', 'Managed OpenCode server runtime.'),
        editable: true
      },
      {
        kind: 'uar',
        mode: 'embedded',
        managedName: 'universal-agent-runtime',
        title: t('settings.agentRuntimes.uar.title', 'Universal Agent Runtime'),
        description: t('settings.agentRuntimes.uar.description', 'Embedded Universal Agent Runtime sidecar.'),
        editable: true
      }
    ],
    [t]
  )

  const getRuntimeConfig = useCallback(
    (row: RuntimeRow): AgentRuntimeConfig =>
      ({
        kind: row.kind,
        mode: row.mode,
        ...settings[row.kind]?.config
      }) as AgentRuntimeConfig,
    [settings]
  )

  const refreshRuntime = useCallback(
    async (row: RuntimeRow) => {
      setLoadingRuntime(row.kind)
      try {
        const nextSettings = await window.api.agentRuntime.getSettings(row.kind)
        setSettings((current) => ({ ...current, [row.kind]: nextSettings }))
        const config = {
          kind: row.kind,
          mode: row.mode,
          ...nextSettings?.config
        } as AgentRuntimeConfig
        const status = await window.api.agentRuntime.getStatus(config)
        setStatuses((current) => ({
          ...current,
          [row.kind]: status
        }))
      } catch (error) {
        setStatuses((current) => ({
          ...current,
          [row.kind]: {
            kind: row.kind,
            state: 'unreachable',
            message:
              error instanceof Error
                ? error.message
                : t('settings.agentRuntimes.statusFailed', 'Failed to load runtime status.')
          }
        }))
      } finally {
        setLoadingRuntime(null)
      }
    },
    [t]
  )

  const refreshDiscovery = useCallback(async (row: RuntimeRow) => {
    if (!row.editable) {
      return
    }

    setLoadingDiscovery(row.kind)
    try {
      const discovery = await window.api.agentRuntime.discoverBinary(row.kind)
      setDiscoveries((current) => ({
        ...current,
        [row.kind]: discovery
      }))
    } finally {
      setLoadingDiscovery(null)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    for (const row of runtimes) {
      await refreshRuntime(row)
      await refreshDiscovery(row)
    }
  }, [refreshDiscovery, refreshRuntime, runtimes])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  const upsertRuntimeConfig = useCallback(
    async (row: RuntimeRow, patch: Partial<AgentRuntimeConfig>) => {
      const currentConfig = getRuntimeConfig(row)
      const nextConfig = {
        ...currentConfig,
        ...patch,
        sidecar: {
          ...currentConfig.sidecar,
          ...patch.sidecar
        }
      } as AgentRuntimeConfig

      const nextSettings = await window.api.agentRuntime.upsertSettings({
        kind: row.kind,
        enabled: true,
        config: nextConfig
      })
      setSettings((current) => ({ ...current, [row.kind]: nextSettings }))
      await refreshRuntime(row)
    },
    [getRuntimeConfig, refreshRuntime]
  )

  const chooseRuntimeBinary = useCallback(
    async (row: RuntimeRow) => {
      const selected = await window.api.file.select({
        title: t('settings.agentRuntimes.chooseTitle', 'Choose runtime executable'),
        properties: ['openFile']
      })
      const pickedPath = selected?.[0]?.path
      if (!pickedPath) {
        return
      }
      await upsertRuntimeConfig(row, { sidecar: { binaryPath: pickedPath } })
    },
    [t, upsertRuntimeConfig]
  )

  const clearRuntimeBinary = useCallback(
    async (row: RuntimeRow) => {
      await upsertRuntimeConfig(row, { sidecar: { binaryPath: undefined } })
    },
    [upsertRuntimeConfig]
  )

  const applyDetectedRuntimeBinary = useCallback(
    async (row: RuntimeRow) => {
      const detectedPath = discoveries[row.kind]?.detectedPath
      if (!detectedPath) {
        return
      }

      await upsertRuntimeConfig(row, { sidecar: { binaryPath: detectedPath } })
    },
    [discoveries, upsertRuntimeConfig]
  )

  const installRuntime = useCallback(
    async (row: RuntimeRow) => {
      if (!row.managedName) {
        return
      }
      setInstallingRuntime(row.kind)
      setStatuses((current) => ({
        ...current,
        [row.kind]: {
          kind: row.kind,
          state: 'downloading',
          binarySource: 'managed',
          message: t('settings.agentRuntimes.downloading', 'Downloading managed runtime binary from IPFS...')
        }
      }))
      try {
        const status = await window.api.agentRuntime.installManagedBinary({ name: row.managedName })
        setStatuses((current) => ({ ...current, [row.kind]: status }))
        await upsertRuntimeConfig(row, { sidecar: { binaryPath: undefined } })
      } finally {
        setInstallingRuntime(null)
      }
    },
    [t, upsertRuntimeConfig]
  )

  const refreshRustToolchainStatus = useCallback(async () => {
    setIsLoadingRustToolchainStatus(true)
    try {
      setRustToolchainStatus(await window.api.dependencies.getStatuses(RUST_TOOLCHAIN_DEPENDENCIES))
    } catch {
      setRustToolchainStatus([])
    } finally {
      setIsLoadingRustToolchainStatus(false)
    }
  }, [])

  useEffect(() => {
    void refreshRustToolchainStatus()
  }, [refreshRustToolchainStatus])

  const installRustToolchain = useCallback(async () => {
    setIsInstallingRustToolchain(true)
    try {
      await window.api.installRustToolchain()
      await refreshRustToolchainStatus()
    } finally {
      setIsInstallingRustToolchain(false)
    }
  }, [refreshRustToolchainStatus])

  return (
    <SettingsContainer>
      <SettingsItem>
        <SettingsTitle>{t('settings.agentRuntimes.title', 'Agent Runtimes')}</SettingsTitle>
        <div className="text-foreground-500 text-sm">
          {t(
            'settings.agentRuntimes.description',
            'Download verified managed runtimes from IPFS or choose local executables for each runtime type.'
          )}
        </div>
      </SettingsItem>

      {runtimes.map((row) => {
        const status = statuses[row.kind]
        const discovery = discoveries[row.kind]
        const config = getRuntimeConfig(row)
        const sidecarPath = typeof config.sidecar?.binaryPath === 'string' ? config.sidecar.binaryPath : undefined
        const resolvedPath = status?.binaryPath ?? sidecarPath
        const highlighted = selectedRuntime === row.kind

        return (
          <SettingsItem
            key={row.kind}
            className={highlighted ? 'rounded-md bg-[var(--color-background-soft)] p-3' : ''}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <SettingsTitle>{row.title}</SettingsTitle>
                  <div className="text-foreground-500 text-sm">{row.description}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Tag>{getRuntimeStateLabel(status?.state ?? 'not-ready', t)}</Tag>
                  {status?.binarySource && <Tag>{getBinarySourceLabel(status.binarySource, t)}</Tag>}
                  {row.kind === 'claude' && (
                    <Tag>{t('settings.agentRuntimes.reference', 'Existing implementation')}</Tag>
                  )}
                </div>
              </div>

              <Alert
                type={getRuntimeHealthAlertType(status?.state)}
                showIcon
                message={
                  status?.message ??
                  t('settings.agentRuntimes.statusUnknown', 'Runtime status has not been checked yet.')
                }
              />

              {row.editable && (
                <>
                  {discovery?.available && discovery.detectedPath && discovery.detectedPath !== sidecarPath && (
                    <Alert
                      type="info"
                      showIcon
                      message={t('settings.agentRuntimes.detectedPath', 'Detected on PATH: {{path}}', {
                        path: discovery.detectedPath
                      })}
                      description={discovery.version}
                    />
                  )}
                  {resolvedPath && (
                    <Input
                      readOnly
                      value={resolvedPath}
                      aria-label={t('settings.agentRuntimes.resolvedPath', 'Runtime executable path')}
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      icon={<RefreshCcw size={15} />}
                      loading={loadingRuntime === row.kind || loadingDiscovery === row.kind}
                      onClick={() => {
                        void refreshRuntime(row)
                        void refreshDiscovery(row)
                      }}>
                      {t('settings.agentRuntimes.refresh', 'Refresh')}
                    </Button>
                    {discovery?.available && discovery.detectedPath && discovery.detectedPath !== sidecarPath && (
                      <Button
                        icon={<FolderOpen size={15} />}
                        onClick={() => {
                          void applyDetectedRuntimeBinary(row)
                        }}>
                        {t('settings.agentRuntimes.useDetected', 'Use detected binary')}
                      </Button>
                    )}
                    <Button
                      icon={<Download size={15} />}
                      loading={installingRuntime === row.kind}
                      disabled={!row.managedName}
                      onClick={() => {
                        void installRuntime(row)
                      }}>
                      {t('settings.agentRuntimes.install', 'Download verified runtime')}
                    </Button>
                    <Button
                      icon={<FolderOpen size={15} />}
                      onClick={() => {
                        void chooseRuntimeBinary(row)
                      }}>
                      {t('settings.agentRuntimes.chooseLocal', 'Choose local binary')}
                    </Button>
                    {sidecarPath && (
                      <Button
                        icon={<Trash2 size={15} />}
                        onClick={() => {
                          void clearRuntimeBinary(row)
                        }}>
                        {t('settings.agentRuntimes.clearLocal', 'Clear local binary')}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </SettingsItem>
        )
      })}

      <SettingsItem divider={false}>
        <SettingsTitle>{t('agent.settings.runtime.rust.title', 'Rust toolchain')}</SettingsTitle>
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {RUST_TOOLCHAIN_DEPENDENCIES.map((name) => {
              const status = rustToolchainStatus.find((item) => item.name === name)
              return (
                <Tag key={name}>
                  {getRustDependencyLabel(name, t)}:{' '}
                  {status?.available ? t('common.ready', 'Ready') : t('common.missing', 'Missing')}
                </Tag>
              )
            })}
          </div>
          <Alert
            type={
              rustToolchainStatus.every((status) => status.available) && rustToolchainStatus.length > 0
                ? 'success'
                : 'warning'
            }
            showIcon
            message={
              rustToolchainStatus.every((status) => status.available) && rustToolchainStatus.length > 0
                ? t('agent.settings.runtime.rust.ready', 'Rust and the wasm32 target are ready for skill builds.')
                : t(
                    'agent.settings.runtime.rust.missing',
                    'Rust, Cargo, rustup, and the wasm32 target are required before Rust/WASM skill workflows compile projects.'
                  )
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button
              loading={isLoadingRustToolchainStatus}
              onClick={() => {
                void refreshRustToolchainStatus()
              }}>
              {t('agent.settings.runtime.rust.refreshStatus', 'Refresh status')}
            </Button>
            <Button
              loading={isInstallingRustToolchain}
              disabled={rustToolchainStatus.length > 0 && rustToolchainStatus.every((status) => status.available)}
              onClick={() => {
                void installRustToolchain()
              }}>
              {t('agent.settings.runtime.rust.install', 'Install/update Rust')}
            </Button>
          </div>
        </div>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default AgentRuntimeSettings

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
    configured: t('agent.settings.runtime.uar.binarySource.configured', 'Selected file'),
    environment: t('agent.settings.runtime.uar.binarySource.environment', 'Environment variable'),
    path: t('agent.settings.runtime.uar.binarySource.path', 'PATH'),
    managed: t('agent.settings.runtime.uar.binarySource.managed', 'Managed binary'),
    development: t('agent.settings.runtime.uar.binarySource.development', 'Development checkout')
  }
  return labels[source]
}

function getRustDependencyLabel(name: ManagedDependencyName, t: ReturnType<typeof useTranslation>['t']): string {
  const labels: Partial<Record<ManagedDependencyName, string>> = {
    rustup: t('agent.settings.runtime.rust.rustup', 'rustup'),
    cargo: t('agent.settings.runtime.rust.cargo', 'Cargo'),
    rustc: t('agent.settings.runtime.rust.rustc', 'rustc'),
    'wasm32-unknown-unknown': t('agent.settings.runtime.rust.wasmTarget', 'wasm32 target')
  }
  return labels[name] ?? name
}
