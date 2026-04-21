import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { InstalledSkill } from '@types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { materializeRuntimeSkillFiles } from '../RuntimeSkillBridgeFiles'

const { tempRoot } = vi.hoisted(() => ({
  tempRoot: { current: '' }
}))

let tempDir: string

vi.mock('node:fs', async (importOriginal) => importOriginal<typeof fs>())
vi.mock('node:os', async (importOriginal) => importOriginal<typeof os>())

vi.mock('@main/utils', () => ({
  getDataPath: (subPath?: string) => path.join(tempRoot.current, 'Data', subPath ?? '')
}))

vi.mock('electron-store', () => ({
  default: class MockElectronStore {
    get(_key: string, defaultValue?: unknown) {
      return defaultValue
    }
    set() {}
  }
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => tempRoot.current),
    getPath: vi.fn(() => path.join(tempRoot.current, 'userData')),
    getVersion: vi.fn(() => '0.0.0-test'),
    once: vi.fn()
  },
  BrowserWindow: class MockBrowserWindow {},
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn()
  },
  net: {
    fetch: vi.fn()
  },
  session: {
    defaultSession: {}
  },
  shell: {},
  nativeTheme: {
    shouldUseDarkColors: false,
    on: vi.fn()
  }
}))

describe('RuntimeSkillBridgeService', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-skill-bridge-'))
    tempRoot.current = tempDir
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('materializes Codex, OpenCode, and UAR native skill files from canonical installed skills', async () => {
    writeCanonicalSkill('install-guide', '# Install Guide\n\nUse these steps.')
    const cwd = path.join(tempDir, 'workspace')
    const skills = [createSkill('skill-1', 'install-guide')]

    const codex = await materializeRuntimeSkillFiles({
      runtimeKind: 'codex',
      cwd,
      agentId: 'agent-1',
      sessionId: 'session-1',
      skills
    })
    const opencode = await materializeRuntimeSkillFiles({
      runtimeKind: 'opencode',
      cwd,
      agentId: 'agent-1',
      sessionId: 'session-1',
      skills
    })
    const uar = await materializeRuntimeSkillFiles({
      runtimeKind: 'uar',
      cwd,
      agentId: 'agent-1',
      sessionId: 'session-1',
      skills
    })

    expect(codex[0]).toEqual(
      expect.objectContaining({
        status: 'synced',
        externalRef: path.join(cwd, '.codex', 'skills', 'install-guide', 'SKILL.md')
      })
    )
    expect(fs.readFileSync(codex[0].externalRef, 'utf8')).toContain('Canonical source remains the app skill registry')
    expect(fs.readFileSync(path.join(cwd, '.opencode', 'agents', 'agent-1.json'), 'utf8')).toContain(
      '.opencode/skills/install-guide/SKILL.md'
    )
    expect(fs.readFileSync(path.join(cwd, '.uar', 'skills.json'), 'utf8')).toContain('"skillId": "skill-1"')
    expect(opencode[0].status).toBe('synced')
    expect(uar[0].status).toBe('synced')
  })

  it('returns an error sync result without writing over canonical skill records', async () => {
    const result = await materializeRuntimeSkillFiles({
      runtimeKind: 'uar',
      cwd: path.join(tempDir, 'workspace'),
      agentId: 'agent-1',
      skills: [createSkill('missing-skill', 'missing-folder')]
    })

    expect(result[0]).toEqual(
      expect.objectContaining({
        status: 'error',
        skillId: 'missing-skill',
        lastError: expect.stringContaining('Missing SKILL.md')
      })
    )
  })
})

function writeCanonicalSkill(folderName: string, content: string): void {
  const skillDir = path.join(tempDir, 'Data', 'Skills', folderName)
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content)
}

function createSkill(id: string, folderName: string): InstalledSkill {
  return {
    id,
    name: folderName,
    description: null,
    folderName,
    source: 'test',
    sourceUrl: null,
    namespace: null,
    author: null,
    tags: [],
    contentHash: `${id}-hash`,
    isEnabled: true,
    createdAt: 1,
    updatedAt: 1
  }
}
