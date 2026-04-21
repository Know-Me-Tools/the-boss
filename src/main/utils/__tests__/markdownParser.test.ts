import * as fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findAllSkillDirectories, parsePluginMetadata, parseSkillMetadata } from '../markdownParser'

vi.mock('fs', () => ({
  promises: {
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn()
  }
}))

vi.mock('../fileOperations', () => ({
  getDirectorySize: vi.fn().mockResolvedValue(123)
}))

describe('markdownParser', () => {
  const pluginContent = `---
name: bad-plugin
description: Use this agent when example: user: "hi"
tools: ["Read", "Grep"]
---

Body`

  const skillContent = `---
name: bad-skill
description: Use this skill when example: user: "hi"
tools: Read, Grep
---

Body`

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.promises.stat).mockResolvedValue({ size: 42 } as fs.Stats)
    vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
      if (String(filePath).includes('SKILL.md')) {
        return skillContent
      }
      return pluginContent
    })
    vi.mocked(fs.promises.readdir).mockResolvedValue([])
  })

  it('recovers invalid plugin frontmatter and keeps metadata', async () => {
    const metadata = await parsePluginMetadata('/abs/plugin.md', 'plugins/plugin.md', 'plugins', 'agent')
    expect(metadata.name).toBe('bad-plugin')
    expect(metadata.description).toContain('example: user')
    expect(metadata.tools).toEqual(['Read', 'Grep'])
  })

  it('recovers invalid skill frontmatter and keeps metadata', async () => {
    const metadata = await parseSkillMetadata('/abs/skill', 'skills/bad-skill', 'skills')
    expect(metadata.name).toBe('bad-skill')
    expect(metadata.description).toContain('example: user')
    expect(metadata.tools).toEqual(['Read', 'Grep'])
  })

  it('finds nested child skill directories below a parent skill', async () => {
    const dirent = (name: string) =>
      ({
        name,
        isDirectory: () => true,
        isSymbolicLink: () => false
      }) as fs.Dirent

    vi.mocked(fs.promises.stat).mockImplementation(async (filePath) => {
      const value = String(filePath)
      if (value === '/repo/skills/parent/SKILL.md' || value === '/repo/skills/parent/skills/child/SKILL.md') {
        return { size: 42 } as fs.Stats
      }
      throw new Error('ENOENT')
    })

    vi.mocked(fs.promises.readdir).mockImplementation(async (dirPath: any) => {
      switch (String(dirPath)) {
        case '/repo':
          return [dirent('skills')] as any
        case '/repo/skills':
          return [dirent('parent')] as any
        case '/repo/skills/parent':
          return [dirent('skills')] as any
        case '/repo/skills/parent/skills':
          return [dirent('child')] as any
        default:
          return [] as any
      }
    })

    const results = await findAllSkillDirectories('/repo', '/repo', 8)

    expect(results).toEqual([
      {
        folderPath: '/repo/skills/parent',
        sourcePath: 'skills/parent'
      },
      {
        folderPath: '/repo/skills/parent/skills/child',
        sourcePath: 'skills/parent/skills/child'
      }
    ])
  })
})
