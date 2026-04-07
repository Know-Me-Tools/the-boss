import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { HOME_CHERRY_DIR } from '@shared/config/constant'
import type { DependencyStatus, ManagedDependencyName } from '@shared/config/types'

import { isWin } from '../constant'
import { getResourcePath, toAsarUnpackedPath } from '.'
import { findExecutableInEnv, getBinaryName } from './process'

const logger = loggerService.withContext('Utils:DependencyStatus')

const MANAGED_DEPENDENCIES: ManagedDependencyName[] = ['uv', 'bun', 'rtk']
const RTK_UNSUPPORTED_PLATFORMS = new Set(['win32-arm64'])

function getManagedBinDir(): string {
  return path.join(os.homedir(), HOME_CHERRY_DIR, 'bin')
}

async function getManagedBinaryPath(name: Exclude<ManagedDependencyName, 'rtk'>): Promise<string> {
  return path.join(getManagedBinDir(), await getBinaryName(name))
}

function getRtkBinaryName(): string {
  return isWin ? 'rtk.exe' : 'rtk'
}

function getRtkPlatformKey(): string {
  return `${process.platform}-${process.arch}`
}

function getUserManagedRtkPath(): string {
  return path.join(getManagedBinDir(), getRtkBinaryName())
}

function getBundledRtkPath(): string | null {
  if (RTK_UNSUPPORTED_PLATFORMS.has(getRtkPlatformKey())) {
    return null
  }

  const binariesDir = toAsarUnpackedPath(path.join(getResourcePath(), 'binaries', getRtkPlatformKey()))
  return path.join(binariesDir, getRtkBinaryName())
}

async function getBundledPath(name: ManagedDependencyName): Promise<string | null> {
  if (name === 'rtk') {
    const userManagedPath = getUserManagedRtkPath()
    if (fs.existsSync(userManagedPath)) {
      return userManagedPath
    }

    const bundledRtkPath = getBundledRtkPath()
    if (bundledRtkPath && fs.existsSync(bundledRtkPath)) {
      return bundledRtkPath
    }

    return bundledRtkPath ?? userManagedPath
  }

  return getManagedBinaryPath(name)
}

function isInstallSupported(name: ManagedDependencyName): boolean {
  return name === 'uv' || name === 'bun'
}

export async function getDependencyStatus(name: ManagedDependencyName): Promise<DependencyStatus> {
  const environmentPath = await findExecutableInEnv(name)
  const bundledPath = await getBundledPath(name)
  const bundledExists = bundledPath ? fs.existsSync(bundledPath) : false

  if (environmentPath) {
    logger.debug(`Resolved ${name} from environment`, { path: environmentPath })
    return {
      name,
      available: true,
      source: 'environment',
      resolvedPath: environmentPath,
      bundledPath,
      environmentPath,
      installSupported: isInstallSupported(name)
    }
  }

  if (bundledExists && bundledPath) {
    logger.debug(`Resolved ${name} from managed path`, { path: bundledPath })
    return {
      name,
      available: true,
      source: 'bundled',
      resolvedPath: bundledPath,
      bundledPath,
      environmentPath: null,
      installSupported: isInstallSupported(name)
    }
  }

  logger.debug(`${name} is missing`, { bundledPath })
  return {
    name,
    available: false,
    source: 'missing',
    resolvedPath: null,
    bundledPath,
    environmentPath: null,
    installSupported: isInstallSupported(name)
  }
}

export async function getDependencyStatuses(
  names: ManagedDependencyName[] = MANAGED_DEPENDENCIES
): Promise<DependencyStatus[]> {
  return Promise.all(names.map((name) => getDependencyStatus(name)))
}
