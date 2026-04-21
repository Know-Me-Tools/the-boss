#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(repoRoot, 'vendor', 'universal-agent-runtime')
const packageManifestPath = path.join(sourceDir, 'Cargo.toml')
const expectedCommit = 'c7c8416b94d39358ec7cf03691738426c25b2df8'
const platformKey = `${process.platform}-${process.arch}`
const binaryName = process.platform === 'win32' ? 'universal-agent-runtime.exe' : 'universal-agent-runtime'
const targetBinaryPath = path.join(sourceDir, 'target', 'release', binaryName)
const outputDir = path.join(repoRoot, 'resources', 'binaries', platformKey)
const outputBinaryPath = path.join(outputDir, binaryName)
const versionPath = path.join(outputDir, '.uar-version')

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      SKIP_FRONTEND_BUILD: process.env.SKIP_FRONTEND_BUILD ?? '1',
      ...options.env
    },
    stdio: 'inherit',
    ...options
  })
}

function readCrateVersion() {
  const manifest = fs.readFileSync(packageManifestPath, 'utf8')
  return manifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? 'unknown'
}

function readSourceCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: sourceDir,
    encoding: 'utf8'
  }).trim()
}

if (!fs.existsSync(packageManifestPath)) {
  throw new Error(
    `Universal Agent Runtime submodule is missing at ${sourceDir}. Run: git submodule update --init vendor/universal-agent-runtime`
  )
}

function buildSidecar() {
  try {
    run('cargo', ['build', '--release', '--locked'], { cwd: sourceDir })
  } catch (error) {
    if (process.env.UAR_REFRESH_LOCKFILE === '0') {
      throw error
    }

    console.warn('Locked Universal Agent Runtime build failed; refreshing Cargo.lock and retrying locked build.')
    run('cargo', ['generate-lockfile'], { cwd: sourceDir })
    run('cargo', ['build', '--release', '--locked'], { cwd: sourceDir })
  }
}

const sourceCommit = readSourceCommit()
if (sourceCommit !== expectedCommit && process.env.UAR_ALLOW_UNPINNED !== '1') {
  throw new Error(
    `Universal Agent Runtime submodule is at ${sourceCommit}, expected ${expectedCommit}. Set UAR_ALLOW_UNPINNED=1 to build a non-pinned checkout.`
  )
}

buildSidecar()

if (!fs.existsSync(targetBinaryPath)) {
  throw new Error(`Expected Universal Agent Runtime binary was not produced: ${targetBinaryPath}`)
}

fs.mkdirSync(outputDir, { recursive: true })
fs.copyFileSync(targetBinaryPath, outputBinaryPath)
fs.chmodSync(outputBinaryPath, 0o755)

const version = {
  package: 'universal-agent-runtime',
  crateVersion: readCrateVersion(),
  sourceUrl: 'git@github.com:Prometheus-AGS/universal-agent-runtime.git',
  sourceCommit,
  expectedCommit,
  platformKey,
  builtAt: new Date().toISOString(),
  binary: binaryName,
  node: process.version,
  host: {
    platform: process.platform,
    arch: process.arch,
    release: os.release()
  }
}

fs.writeFileSync(versionPath, `${JSON.stringify(version, null, 2)}\n`)

console.log(`Universal Agent Runtime sidecar copied to ${outputBinaryPath}`)
console.log(`Universal Agent Runtime version metadata written to ${versionPath}`)
