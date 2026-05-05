import { execFileSync } from 'node:child_process'
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

const MANAGED_DEPENDENCIES: ManagedDependencyName[] = [
  'uv',
  'bun',
  'rtk',
  'rustup',
  'cargo',
  'rustc',
  'wasm32-unknown-unknown'
]
const RTK_UNSUPPORTED_PLATFORMS = new Set(['win32-arm64'])

function getManagedBinDir(): string {
  return path.join(os.homedir(), HOME_CHERRY_DIR, 'bin')
}

async function getManagedBinaryPath(
  name: Exclude<ManagedDependencyName, 'rtk' | 'wasm32-unknown-unknown'>
): Promise<string> {
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

  if (name === 'wasm32-unknown-unknown') {
    return null
  }

  return getManagedBinaryPath(name)
}

function isInstallSupported(name: ManagedDependencyName): boolean {
  return (
    name === 'uv' ||
    name === 'bun' ||
    name === 'rustup' ||
    name === 'cargo' ||
    name === 'rustc' ||
    name === 'wasm32-unknown-unknown'
  )
}

export async function getDependencyStatus(name: ManagedDependencyName): Promise<DependencyStatus> {
  if (name === 'wasm32-unknown-unknown') {
    return getRustTargetStatus(name)
  }

  const environmentPath = await findExecutableInEnv(name)
  const rustToolchainPath = isRustToolchainBinary(name) ? getCargoHomeBinaryPath(name) : null
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

  if (rustToolchainPath && fs.existsSync(rustToolchainPath)) {
    logger.debug(`Resolved ${name} from Rust toolchain path`, { path: rustToolchainPath })
    return {
      name,
      available: true,
      source: 'environment',
      resolvedPath: rustToolchainPath,
      bundledPath,
      environmentPath: rustToolchainPath,
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

async function getRustTargetStatus(name: ManagedDependencyName): Promise<DependencyStatus> {
  const rustupPath = (await findExecutableInEnv('rustup')) ?? getExistingCargoHomeBinaryPath('rustup')
  const available = Boolean(rustupPath && isRustTargetInstalled('wasm32-unknown-unknown'))
  return {
    name,
    available,
    source: available ? 'environment' : 'missing',
    resolvedPath: available ? rustupPath : null,
    bundledPath: null,
    environmentPath: rustupPath,
    installSupported: true
  }
}

function isRustTargetInstalled(target: string): boolean {
  try {
    const rustupPath = getExistingCargoHomeBinaryPath('rustup') ?? 'rustup'
    const output = execFileSync(rustupPath, ['target', 'list', '--installed'], { encoding: 'utf8' })
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .includes(target)
  } catch {
    return false
  }
}

function isRustToolchainBinary(
  name: ManagedDependencyName
): name is Extract<ManagedDependencyName, 'rustup' | 'cargo' | 'rustc'> {
  return name === 'rustup' || name === 'cargo' || name === 'rustc'
}

function getCargoHomeBinaryPath(name: 'rustup' | 'cargo' | 'rustc'): string {
  const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo')
  return path.join(cargoHome, 'bin', isWin ? `${name}.exe` : name)
}

function getExistingCargoHomeBinaryPath(name: 'rustup' | 'cargo' | 'rustc'): string | null {
  const candidate = getCargoHomeBinaryPath(name)
  return fs.existsSync(candidate) ? candidate : null
}

export async function getDependencyStatuses(
  names: ManagedDependencyName[] = MANAGED_DEPENDENCIES
): Promise<DependencyStatus[]> {
  return Promise.all(names.map((name) => getDependencyStatus(name)))
}
