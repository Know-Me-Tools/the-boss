#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const outRoot = path.join(repoRoot, 'dist', 'runtime-artifacts')
const platformKey = `${process.platform}-${process.arch}`

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    ...options
  })
}

function readGitCommit(cwd) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
}

function copyExecutable(source, target) {
  if (!fs.existsSync(source)) {
    throw new Error(`Expected runtime artifact was not produced: ${source}`)
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
  if (process.platform !== 'win32') {
    fs.chmodSync(target, 0o755)
  }
}

function fileInfo(filePath) {
  const buffer = fs.readFileSync(filePath)
  return {
    size: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex')
  }
}

function writeManifest(manifest) {
  const outPath = path.join(outRoot, `${manifest.name}.manifest.json`)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return outPath
}

function buildUar() {
  const sourceDir = path.join(repoRoot, 'vendor', 'universal-agent-runtime')
  const binaryName = process.platform === 'win32' ? 'universal-agent-runtime.exe' : 'universal-agent-runtime'
  run('cargo', ['build', '--release', '--locked'], { cwd: sourceDir })
  const source = path.join(sourceDir, 'target', 'release', binaryName)
  const target = path.join(outRoot, 'universal-agent-runtime', platformKey, binaryName)
  copyExecutable(source, target)
  return manifestFor('universal-agent-runtime', readGitCommit(sourceDir), binaryName, target)
}

function buildOpenCode() {
  run(process.execPath, [path.join(repoRoot, 'scripts', 'build-opencode-runtime.js')])
  const binaryName = process.platform === 'win32' ? 'opencode.exe' : 'opencode'
  const source = path.join(repoRoot, 'resources', 'opencode', platformKey, binaryName)
  const target = path.join(outRoot, 'opencode', platformKey, binaryName)
  copyExecutable(source, target)
  return manifestFor('opencode', readGitCommit(path.join(repoRoot, 'vendor', 'opencode')), binaryName, target)
}

function buildCodex() {
  const sourceDir = path.join(repoRoot, 'vendor', 'codex')
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  run('cargo', [
    'build',
    '--manifest-path',
    path.join(sourceDir, 'codex-rs', 'Cargo.toml'),
    '--release',
    '--locked',
    '--bin',
    'codex'
  ])
  const source = path.join(sourceDir, 'codex-rs', 'target', 'release', binaryName)
  const target = path.join(outRoot, 'codex', platformKey, binaryName)
  copyExecutable(source, target)
  return manifestFor('codex', readGitCommit(sourceDir), binaryName, target)
}

function manifestFor(name, sourceCommit, binaryName, filePath) {
  return {
    name,
    version: sourceCommit,
    sourceCommit,
    supportedPlatforms: [platformKey],
    binaries: [
      {
        platform: platformKey,
        binaryName,
        ...fileInfo(filePath),
        filePath
      }
    ]
  }
}

function main() {
  const only = new Set(process.argv.slice(2))
  const manifests = []
  if (only.size === 0 || only.has('uar') || only.has('universal-agent-runtime')) manifests.push(buildUar())
  if (only.size === 0 || only.has('opencode')) manifests.push(buildOpenCode())
  if (only.size === 0 || only.has('codex')) manifests.push(buildCodex())

  for (const manifest of manifests) {
    const manifestPath = writeManifest(manifest)
    console.log(`Runtime manifest written to ${path.relative(repoRoot, manifestPath)}`)
  }
}

main()
