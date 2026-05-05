import type { AgentRuntimeProfile, AgentRuntimeSettings, GetAgentSessionResponse } from '@types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

vi.mock('electron', () => ({
  app: {
    once: vi.fn(),
    getPath: vi.fn(() => '/tmp'),
    getAppPath: vi.fn(() => '/app'),
    getLocale: vi.fn(() => 'en-US')
  },
  BrowserWindow: Object.assign(vi.fn(), {
    getAllWindows: vi.fn(() => [])
  }),
  dialog: {},
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn()
  },
  nativeTheme: {
    on: vi.fn(),
    themeSource: 'system',
    shouldUseDarkColors: false
  },
  screen: {},
  session: {},
  shell: {}
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: true,
    macOS: false,
    windows: false,
    linux: true
  }
}))

vi.mock('electron-window-state', () => ({
  default: vi.fn(() => ({
    x: 0,
    y: 0,
    width: 1024,
    height: 768,
    manage: vi.fn()
  }))
}))

vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(function MockStore() {
    return {
      get: vi.fn((_: string, defaultValue?: unknown) => defaultValue),
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      has: vi.fn(() => false),
      store: {}
    }
  })
}))

vi.mock('@main/utils', () => ({
  getDataPath: vi.fn(() => '/tmp/uar'),
  getResourcePath: vi.fn(() => '/tmp/resources'),
  toAsarUnpackedPath: (filePath: string) => filePath
}))

import { RuntimeControlService } from '../RuntimeControlService'

describe('RuntimeControlService', () => {
  it('merges global settings, selected profile, and session runtime overrides into the effective config', async () => {
    const repository = {
      getSettings: vi.fn(async () => createSettings()),
      getProfile: vi.fn(async () => createProfile())
    }
    const service = new RuntimeControlService({ runtimeProfileRepository: repository as never })

    const result = await service.resolveEffectiveRuntimeConfig(
      createSession({
        kind: 'codex',
        mode: 'managed',
        profileId: 'codex-strict',
        sandbox: {
          networkAccess: true
        },
        permissions: {
          mode: 'on-request'
        }
      })
    )

    expect(repository.getSettings).toHaveBeenCalledWith('codex')
    expect(repository.getProfile).toHaveBeenCalledWith('codex-strict')
    expect(result).toEqual(
      expect.objectContaining({
        kind: 'codex',
        mode: 'managed',
        providerId: 'openai',
        modelId: 'gpt-5.2',
        profileId: 'codex-strict',
        sandbox: {
          mode: 'workspace-write',
          networkAccess: true
        },
        permissions: {
          mode: 'on-request'
        }
      })
    )
  })

  it('starts embedded UAR and returns concrete health status when testing the connection', async () => {
    const service = new RuntimeControlService({
      universalAgentRuntimeService: {
        ensureRunning: vi.fn(async () => 'http://127.0.0.1:1906'),
        getStatus: vi.fn(async () => ({
          kind: 'uar',
          state: 'ready',
          endpoint: 'http://127.0.0.1:1906',
          message: 'UAR sidecar is ready.'
        })),
        installManagedBinary: vi.fn()
      } as never
    })

    await expect(service.testConnection({ kind: 'uar', mode: 'embedded' })).resolves.toEqual(
      expect.objectContaining({
        kind: 'uar',
        state: 'ready',
        endpoint: 'http://127.0.0.1:1906'
      })
    )
  })

  it('installs managed UAR binaries through the runtime control plane', async () => {
    const installManagedBinary = vi.fn(async () => ({
      kind: 'uar',
      state: 'installed',
      binarySource: 'managed',
      message: 'Managed UAR binary is installed.'
    }))
    const service = new RuntimeControlService({
      universalAgentRuntimeService: {
        ensureRunning: vi.fn(),
        getStatus: vi.fn(),
        installManagedBinary,
        stop: vi.fn()
      } as never
    })

    await expect(service.installManagedBinary({ name: 'universal-agent-runtime' })).resolves.toEqual(
      expect.objectContaining({
        kind: 'uar',
        state: 'installed',
        binarySource: 'managed'
      })
    )
    expect(installManagedBinary).toHaveBeenCalled()
  })

  it('rejects unsupported managed binary install requests', async () => {
    const installManagedBinary = vi.fn()
    const service = new RuntimeControlService({
      universalAgentRuntimeService: {
        ensureRunning: vi.fn(),
        getStatus: vi.fn(),
        installManagedBinary,
        stop: vi.fn()
      } as never
    })

    await expect(service.installManagedBinary({ name: 'other-helper' })).resolves.toEqual(
      expect.objectContaining({
        kind: 'uar',
        state: 'unsupported'
      })
    )
    expect(installManagedBinary).not.toHaveBeenCalled()
  })

  it('installs managed Codex binaries through the managed runtime service', async () => {
    const install = vi.fn(async () => ({
      name: 'codex',
      version: '1.0.0',
      platform: 'linux-x64',
      state: 'installed' as const,
      binaryPath: '/tmp/codex',
      message: 'Managed Codex binary is installed.'
    }))
    const service = new RuntimeControlService({
      managedRuntimeService: {
        install
      } as never
    })

    await expect(service.installManagedBinary({ name: 'codex' })).resolves.toEqual(
      expect.objectContaining({
        kind: 'codex',
        state: 'installed',
        binarySource: 'managed',
        message: 'Managed Codex binary is installed.'
      })
    )
    expect(install).toHaveBeenCalledWith('codex')
  })

  it('discovers existing runtime binaries from PATH through the runtime control plane', async () => {
    const discover = vi.fn(async () => ({
      kind: 'opencode',
      command: 'opencode',
      detectedPath: '/usr/local/bin/opencode',
      version: 'opencode 1.0.0',
      source: 'path' as const,
      available: true,
      message: 'opencode was detected on PATH at /usr/local/bin/opencode.'
    }))
    const service = new RuntimeControlService({
      runtimeBinaryDiscoveryService: {
        discover
      } as never
    })

    await expect(service.discoverRuntimeBinary('opencode')).resolves.toEqual(
      expect.objectContaining({
        kind: 'opencode',
        command: 'opencode',
        detectedPath: '/usr/local/bin/opencode',
        available: true
      })
    )
    expect(discover).toHaveBeenCalledWith('opencode')
  })

  it('checks managed Codex binary health through the Codex CLI service', async () => {
    const service = new RuntimeControlService({
      codexCliService: {
        resolveBinary: vi.fn(() => ({
          state: 'missing-binary' as const,
          message: 'Codex CLI executable was not found.'
        })),
        listModels: vi.fn()
      }
    })

    await expect(service.testConnection({ kind: 'codex', mode: 'managed' })).resolves.toEqual(
      expect.objectContaining({
        kind: 'codex',
        state: 'missing-binary',
        message: 'Codex CLI executable was not found.'
      })
    )
  })

  it('checks managed OpenCode binary health and lists OpenCode models through the OpenCode service', async () => {
    const listModels = vi.fn(async () => [
      {
        id: 'openai/gpt-5.2',
        providerId: 'openai',
        modelId: 'gpt-5.2',
        displayName: 'GPT 5.2',
        providerName: 'OpenAI',
        hidden: false,
        isDefault: true,
        capabilities: {}
      }
    ])
    const service = new RuntimeControlService({
      openCodeCliService: {
        resolveBinary: vi.fn(() => ({
          state: 'ready' as const,
          source: 'managed' as const,
          message: 'OpenCode executable resolved from verified managed binary.'
        })),
        listModels
      }
    })

    await expect(service.testConnection({ kind: 'opencode', mode: 'managed' })).resolves.toEqual(
      expect.objectContaining({
        kind: 'opencode',
        state: 'ready',
        binarySource: 'managed',
        message: 'OpenCode executable resolved from verified managed binary.'
      })
    )
    await expect(service.listOpenCodeModels({ kind: 'opencode', mode: 'managed' })).resolves.toEqual([
      expect.objectContaining({
        id: 'openai/gpt-5.2'
      })
    ])
    expect(listModels).toHaveBeenCalledWith({ kind: 'opencode', mode: 'managed' })
  })

  it('blocks non-Claude runtime execution when the binary is missing', async () => {
    const service = new RuntimeControlService({
      codexCliService: {
        resolveBinary: vi.fn(() => ({
          state: 'missing-binary' as const,
          message: 'Codex CLI executable was not found.'
        })),
        listModels: vi.fn()
      }
    })

    await expect(service.ensureRunnable({ kind: 'codex', mode: 'managed' })).rejects.toThrow(
      'Agent runtime is not ready for codex'
    )
  })

  it('keeps Claude execution ungated by managed binary readiness checks', async () => {
    const service = new RuntimeControlService()

    await expect(service.ensureRunnable({ kind: 'claude', mode: 'managed' })).resolves.toBeUndefined()
  })
})

function createSettings(): AgentRuntimeSettings {
  return {
    kind: 'codex',
    enabled: true,
    config: {
      kind: 'codex',
      mode: 'managed',
      providerId: 'openai',
      sandbox: {
        mode: 'read-only',
        networkAccess: false
      },
      permissions: {
        mode: 'never'
      }
    }
  }
}

function createProfile(): AgentRuntimeProfile {
  return {
    id: 'codex-strict',
    name: 'Codex Strict',
    kind: 'codex',
    config: {
      kind: 'codex',
      mode: 'managed',
      modelId: 'gpt-5.2',
      sandbox: {
        mode: 'workspace-write'
      }
    },
    isDefault: false,
    created_at: '2026-04-17T20:00:00.000Z',
    updated_at: '2026-04-17T20:00:00.000Z'
  }
}

function createSession(
  runtime: NonNullable<GetAgentSessionResponse['configuration']>['runtime']
): GetAgentSessionResponse {
  return {
    id: 'session-id',
    agent_id: 'agent-id',
    agent_type: 'agent',
    name: 'Runtime Agent',
    accessible_paths: ['/tmp/workspace'],
    model: 'openai:gpt-5.2',
    created_at: '2026-04-17T20:00:00.000Z',
    updated_at: '2026-04-17T20:00:00.000Z',
    configuration: {
      permission_mode: 'default',
      max_turns: 100,
      env_vars: {},
      runtime
    }
  }
}
