import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { findAllSkillDirectories, findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'
import { app } from 'electron'

import { SkillRepository } from '../services/agents/skills/SkillRepository'
import { skillService } from '../services/agents/skills/SkillService'
import { getDataPath, toAsarUnpackedPath } from '.'

const logger = loggerService.withContext('builtinSkills')

const VERSION_FILE = '.version'
const PROMETHEUS_SKILL_SYSTEM_DIR = 'prometheus-skill-system'
const PROMETHEUS_SKILL_SYSTEM_REPO = 'git@github.com:Prometheus-AGS/prometheus-skill-system.git'

type BuiltinSkillSource = {
  folderName: string
  sourcePath: string
  sourceFolderPath: string
  sourceUrl: string | null
}

/**
 * Copy built-in skills from app resources to the global skills storage
 * directory and register them in the `skills` DB table.
 *
 * Storage:  {userData}/Data/Skills/{folderName}/
 *
 * Per-agent enablement is handled separately: each existing agent gets a
 * symlink at `{agentWorkspace}/.claude/skills/{folderName}/` via
 * `skillService.enableForAllAgents` for any **newly registered** builtin
 * (i.e. first-run or app-upgrade that adds a new builtin). Already-registered
 * builtins are left alone so user per-agent choices survive upgrades.
 *
 * Each installed skill gets a `.version` file recording the app version that
 * installed it. On subsequent launches the bundled version is compared with
 * the installed version — the skill files are overwritten only when the app
 * ships a newer version.
 */
// TODO: v2-backup
export async function installBuiltinSkills(): Promise<void> {
  const resourceSkillsPath = toAsarUnpackedPath(path.join(app.getAppPath(), 'resources', 'skills'))
  const globalSkillsPath = getDataPath('Skills')
  const appVersion = app.getVersion()

  try {
    await fs.access(resourceSkillsPath)
  } catch {
    return
  }

  const sources = await discoverBuiltinSkillSources(resourceSkillsPath)

  let installed = 0
  // Process sequentially to avoid interleaved delete+insert on the skills
  // table when multiple builtins require a metadata refresh.
  for (const source of sources) {
    const destPath = path.join(globalSkillsPath, source.folderName)
    const filesUpdated = !(await isUpToDate(destPath, appVersion))

    if (filesUpdated) {
      await fs.mkdir(destPath, { recursive: true })
      await fs.cp(source.sourceFolderPath, destPath, { recursive: true })
      await fs.writeFile(path.join(destPath, VERSION_FILE), appVersion, 'utf-8')
      installed++
    }

    // Register (or refresh) the DB row; fan the skill out to existing agents
    // only when this is the first time we see it.
    await syncBuiltinSkillToDb(source.folderName, destPath, filesUpdated, source.sourcePath, source.sourceUrl)
  }

  if (installed > 0) {
    logger.info('Built-in skills installed', { installed, version: appVersion })
  }
}

async function discoverBuiltinSkillSources(resourceSkillsPath: string): Promise<BuiltinSkillSource[]> {
  const entries = await fs.readdir(resourceSkillsPath, { withFileTypes: true })
  const sources: BuiltinSkillSource[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!isSafeResourceEntryName(entry.name)) continue

    const entryPath = path.join(resourceSkillsPath, entry.name)
    const directDestPath = path.join(getDataPath('Skills'), sanitizeSkillFolderName(entry.name))
    if (!directDestPath.startsWith(getDataPath('Skills') + path.sep)) continue

    const directSkillPath = await findSkillMdPath(entryPath)
    if (directSkillPath) {
      sources.push({
        folderName: sanitizeSkillFolderName(entry.name),
        sourcePath: entry.name,
        sourceFolderPath: entryPath,
        sourceUrl: null
      })
      continue
    }

    if (entry.name !== PROMETHEUS_SKILL_SYSTEM_DIR) {
      continue
    }

    const nestedSkillDirs = await findAllSkillDirectories(entryPath, entryPath, 12)
    for (const nestedSkillDir of nestedSkillDirs) {
      const relativeSourcePath = path.join(entry.name, nestedSkillDir.sourcePath)
      sources.push({
        folderName: sanitizeSkillFolderName(relativeSourcePath),
        sourcePath: relativeSourcePath,
        sourceFolderPath: nestedSkillDir.folderPath,
        sourceUrl: `${PROMETHEUS_SKILL_SYSTEM_REPO}#${nestedSkillDir.sourcePath}`
      })
    }
  }

  return sources
}

function sanitizeSkillFolderName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '__').replace(/^__+|__+$/g, '')
}

function isSafeResourceEntryName(value: string): boolean {
  return value !== '..' && !value.includes('/') && !value.includes('\\') && !value.includes('\0')
}

/**
 * Ensure a built-in skill has a corresponding row in the `skills` DB table.
 * If the row already exists and files were not updated, skip.
 * If files were updated the metadata is refreshed. If the row is missing
 * entirely (first time we see this builtin) the skill is fanned out to every
 * existing agent's workspace.
 */
async function syncBuiltinSkillToDb(
  folderName: string,
  destPath: string,
  filesUpdated: boolean,
  sourcePath: string,
  sourceUrl: string | null
): Promise<void> {
  try {
    const repo = SkillRepository.getInstance()
    const existing = await repo.getByFolderName(folderName)

    if (existing && !filesUpdated) return

    const metadata = await parseSkillMetadata(destPath, sourcePath, 'skills')
    const contentHash = await computeHash(destPath)

    const tags = metadata.tags ? JSON.stringify(metadata.tags) : null

    if (existing) {
      // Update metadata in-place to preserve the skill ID and its agent_skills
      // rows (per-agent enablement state survives app upgrades).
      await repo.updateMetadata(existing.id, {
        name: metadata.name,
        description: metadata.description ?? null,
        author: metadata.author ?? null,
        tags,
        content_hash: contentHash
      })
    } else {
      const now = Date.now()
      const inserted = await repo.insert({
        name: metadata.name,
        description: metadata.description ?? null,
        folder_name: folderName,
        source: 'builtin',
        source_url: sourceUrl,
        namespace: null,
        author: metadata.author ?? null,
        tags,
        content_hash: contentHash,
        is_enabled: false,
        created_at: now,
        updated_at: now
      })

      // Fan out to every agent on first install only.
      await skillService.enableForAllAgents(inserted.id, folderName)
    }

    logger.info('Built-in skill synced to DB', { folderName, firstInstall: !existing })
  } catch (error) {
    logger.warn('Failed to sync built-in skill to DB', {
      folderName,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function computeHash(skillDir: string): Promise<string> {
  const candidates = ['SKILL.md', 'skill.md']
  for (const name of candidates) {
    try {
      const content = await fs.readFile(path.join(skillDir, name), 'utf-8')
      return createHash('sha256').update(content).digest('hex')
    } catch {
      // try next
    }
  }
  return ''
}

async function isUpToDate(destPath: string, appVersion: string): Promise<boolean> {
  try {
    const installedVersion = (await fs.readFile(path.join(destPath, VERSION_FILE), 'utf-8')).trim()
    return installedVersion === appVersion
  } catch {
    return false
  }
}
