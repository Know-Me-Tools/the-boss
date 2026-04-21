const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const packageDir = path.join(root, 'vendor', 'opencode', 'packages', 'opencode')

const platform = (() => {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
  if (!arch) {
    throw new Error(`Unsupported OpenCode runtime architecture: ${process.arch}`)
  }

  if (process.platform === 'darwin') {
    return { resourceDir: `darwin-${arch}`, buildName: `opencode-darwin-${arch}`, outputName: 'opencode' }
  }
  if (process.platform === 'linux') {
    return { resourceDir: `linux-${arch}`, buildName: `opencode-linux-${arch}`, outputName: 'opencode' }
  }
  if (process.platform === 'win32') {
    return { resourceDir: `win32-${arch}`, buildName: `opencode-windows-${arch}`, outputName: 'opencode.exe' }
  }

  throw new Error(`Unsupported OpenCode runtime platform: ${process.platform}`)
})()

if (!fs.existsSync(packageDir)) {
  throw new Error(`OpenCode submodule package directory is missing: ${packageDir}`)
}

const bunVersion = spawnSync('bun', ['--version'], { cwd: root, encoding: 'utf8' })
if (bunVersion.status !== 0) {
  throw new Error('OpenCode runtime build requires Bun, but `bun --version` failed.')
}
assertMinimumBunVersion(bunVersion.stdout.trim(), [1, 3, 11])

const build = spawnSync('bun', ['run', '--cwd', packageDir, 'build', '--single', '--skip-embed-web-ui'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
})

if (build.status !== 0) {
  throw new Error(`OpenCode runtime build failed with status ${build.status ?? 'unknown'}`)
}

const sourceDir = path.join(packageDir, 'dist', platform.buildName, 'bin')
const sourceCandidates =
  process.platform === 'win32'
    ? [path.join(sourceDir, 'opencode.exe'), path.join(sourceDir, 'opencode')]
    : [path.join(sourceDir, 'opencode')]
const source = sourceCandidates.find((candidate) => fs.existsSync(candidate))
if (!source) {
  throw new Error(`OpenCode runtime build did not produce an executable under ${sourceDir}`)
}

const targetDir = path.join(root, 'resources', 'opencode', platform.resourceDir)
const target = path.join(targetDir, platform.outputName)
fs.mkdirSync(targetDir, { recursive: true })
fs.copyFileSync(source, target)
if (process.platform !== 'win32') {
  fs.chmodSync(target, 0o755)
}

console.log(`OpenCode runtime copied to ${path.relative(root, target)}`)

function assertMinimumBunVersion(version, minimum) {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10))
  for (let index = 0; index < minimum.length; index += 1) {
    const actual = Number.isFinite(parts[index]) ? parts[index] : 0
    if (actual > minimum[index]) return
    if (actual < minimum[index]) {
      throw new Error(`OpenCode runtime build requires Bun >= ${minimum.join('.')}; found ${version}.`)
    }
  }
}
