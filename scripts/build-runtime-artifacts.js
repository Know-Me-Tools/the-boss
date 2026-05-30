#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const outRoot = path.join(repoRoot, 'dist', 'runtime-artifacts')
const platformKey = `${process.platform}-${process.arch}`

// Archive format is selected by the TARGET platform (the platform the binary is
// built for), not the host platform. This lets CI package per-matrix-entry.
const UNIX_ARCHIVE_FORMAT = 'tar.zst'
const WIN_ARCHIVE_FORMAT = 'zip'

// Constant timestamp stamped onto staged files before archiving so two
// byte-identical builds produce the same archive bytes (and therefore the same
// archiveSha256). Without this, tar/zip embed each file's real mtime and the
// hash would drift between otherwise-identical runs. Using a fixed epoch.
const DETERMINISTIC_MTIME = new Date(0)

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

/**
 * Returns the archive format ('zip' for win32 targets, 'tar.zst' otherwise)
 * for a platform-arch triple like 'win32-x64' or 'linux-x64'.
 *
 * @param {string} platform
 * @returns {'zip' | 'tar.zst'}
 */
function archiveFormatForPlatform(platform) {
  return platform.startsWith('win32-') ? WIN_ARCHIVE_FORMAT : UNIX_ARCHIVE_FORMAT
}

/**
 * Copies a file into the staging directory, returning the relative entry name
 * used inside the archive. Skips (returns null) when the source is missing.
 */
function stageFile(source, stagingDir, relativeName) {
  if (!source || !fs.existsSync(source)) {
    return null
  }
  const target = path.join(stagingDir, relativeName)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
  return relativeName
}

/**
 * Packages a built runtime binary into a distributable archive.
 *
 * Stages the executable + a metadata.json + any license/notice files + an
 * optional SBOM + an optional pre-existing detached signature, then produces a
 * tar.zst archive (non-win32 targets) or a zip archive (win32 targets).
 *
 * NOTE on signing: this function only BUNDLES a detached signature if one
 * already exists at `signaturePath`. Producing the signature (env-gated, CI)
 * lands in Task 6 of change-024; this is the seam for it.
 *
 * @param {{
 *   runtime: string,
 *   platform: string,
 *   binaryPath: string,
 *   binaryName: string,
 *   metadata: object,
 *   licenseDir?: string,
 *   sbomPath?: string,
 *   signaturePath?: string,
 *   outDir: string
 * }} params
 * @returns {{ archivePath: string, archiveName: string, archiveSha256: string, archiveSize: number, format: string }}
 */
function packageRuntimeArchive({
  runtime,
  platform,
  binaryPath,
  binaryName,
  metadata,
  licenseDir,
  sbomPath,
  signaturePath,
  outDir
}) {
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Cannot package archive; binary not found: ${binaryPath}`)
  }

  const format = archiveFormatForPlatform(platform)
  const archiveName = `${runtime}-${platform}.${format}`
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `runtime-stage-${runtime}-`))

  try {
    // Executable. Existence is asserted above, so copy directly (a missing
    // source is a hard error, not a skip) rather than going through stageFile,
    // whose null-on-missing return would be silently ignored here.
    const binaryTarget = path.join(stagingDir, binaryName)
    fs.copyFileSync(binaryPath, binaryTarget)
    // Set the exec bit based on the TARGET platform, not the HOST. A unix target
    // packaged on a win32 host must still carry the exec bit; a win32 target
    // never gets chmod-ed (and win32 has no POSIX exec bit anyway).
    if (!platform.startsWith('win32-')) {
      fs.chmodSync(binaryTarget, 0o755)
    }

    // Metadata document.
    fs.writeFileSync(path.join(stagingDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`)

    // License / notice files (copied under licenses/ if the dir exists).
    if (licenseDir && fs.existsSync(licenseDir) && fs.statSync(licenseDir).isDirectory()) {
      for (const name of fs.readdirSync(licenseDir)) {
        const source = path.join(licenseDir, name)
        if (fs.statSync(source).isFile()) {
          stageFile(source, stagingDir, path.join('licenses', name))
        }
      }
    }

    // Optional SBOM.
    if (sbomPath) {
      stageFile(sbomPath, stagingDir, path.basename(sbomPath))
    }

    // Optional pre-existing detached signature (see Task 6 note above).
    if (signaturePath) {
      stageFile(signaturePath, stagingDir, path.basename(signaturePath))
    }

    fs.mkdirSync(outDir, { recursive: true })
    const archivePath = path.join(outDir, archiveName)

    // Stamp a constant mtime on every staged file so the archive bytes (and
    // thus archiveSha256) are reproducible across identical builds. Both tar
    // and adm-zip embed file mtimes; without this the hash drifts per run.
    stampDeterministicMtimes(stagingDir)

    if (format === WIN_ARCHIVE_FORMAT) {
      // zip via adm-zip (synchronous, no system `zip` dependency required).
      buildZipSync(stagingDir, archivePath)
    } else {
      // System tar supports zstd compression (bsdtar/GNU tar). The repo already
      // shells out to system tar in download-rtk-binaries.js. Pass explicit
      // top-level members (not '.') so entries are flat names without a './'
      // prefix, matching the zip layout. Sort the members so the archive entry
      // order is deterministic (readdir order is filesystem-dependent), and
      // zero out owner/group metadata for reproducible archive bytes.
      const members = fs.readdirSync(stagingDir).sort()
      execFileSync('tar', ['--zstd', '--uid', '0', '--gid', '0', '-cf', archivePath, '-C', stagingDir, ...members], {
        stdio: 'inherit'
      })
    }

    const info = fileInfo(archivePath)
    return {
      archivePath,
      archiveName,
      archiveSha256: info.sha256,
      archiveSize: info.size,
      format
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true })
  }
}

/**
 * Recursively stamps a constant mtime (and atime) on every file and directory
 * under `dir`. This removes the only build-to-build varying input the archivers
 * embed, making archive bytes — and the resulting SHA-256 — reproducible.
 *
 * @param {string} dir
 */
function stampDeterministicMtimes(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      stampDeterministicMtimes(entryPath)
    }
    fs.utimesSync(entryPath, DETERMINISTIC_MTIME, DETERMINISTIC_MTIME)
  }
  fs.utimesSync(dir, DETERMINISTIC_MTIME, DETERMINISTIC_MTIME)
}

/**
 * Builds a zip archive synchronously using adm-zip so packageRuntimeArchive can
 * stay a synchronous function (no event-loop reentrancy needed). Entries are
 * added in sorted order with a constant timestamp so the archive bytes are
 * deterministic across identical builds.
 *
 * @param {string} stagingDir
 * @param {string} archivePath
 */
function buildZipSync(stagingDir, archivePath) {
  // Lazy require keeps the dependency out of the unix code path.

  const AdmZip = require('adm-zip')
  const zip = new AdmZip()
  // Add files explicitly in sorted order (readdir order is filesystem
  // dependent) with a fixed timestamp so two identical builds produce the same
  // archive bytes. addLocalFolder's traversal order is not guaranteed, and the
  // entry timestamp must be set on the header (the addFile signature does not
  // accept an mtime), otherwise it defaults to "now" and breaks determinism.
  for (const entryName of listFilesRecursive(stagingDir).sort()) {
    const absPath = path.join(stagingDir, entryName)
    zip.addFile(entryName, fs.readFileSync(absPath))
    const added = zip.getEntry(entryName)
    if (added) {
      added.header.time = DETERMINISTIC_MTIME
    }
  }
  zip.writeZip(archivePath)
}

/**
 * Returns archive-relative paths (POSIX separators) for every file under `dir`,
 * recursively. Directories are represented implicitly via their files.
 *
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {string[]}
 */
function listFilesRecursive(dir, prefix = '') {
  const result = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relName = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      result.push(...listFilesRecursive(path.join(dir, entry.name), relName))
    } else {
      result.push(relName)
    }
  }
  return result
}

/**
 * Returns a NEW manifest binary entry enriched with archive metadata. Does not
 * mutate the input entry. Defaults maxSize to the binary size when not already
 * present.
 *
 * @param {{ size: number, [k: string]: unknown }} entry
 * @param {{ archiveName: string, archiveSha256: string, archiveSize: number, format: string }} archive
 * @returns {object}
 */
function enrichManifestEntryWithArchive(entry, archive) {
  return {
    ...entry,
    maxSize: typeof entry.maxSize === 'number' ? entry.maxSize : entry.size,
    archiveName: archive.archiveName,
    archiveSha256: archive.archiveSha256,
    archiveSize: archive.archiveSize,
    archiveFormat: archive.format
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
  const binaryInfo = fileInfo(filePath)
  const builtAt = new Date().toISOString()

  // Package the binary into a distributable archive and enrich the manifest
  // entry with the archive's name/hash/size/format.
  const metadata = {
    name,
    version: sourceCommit,
    platform: platformKey,
    binaryName,
    sha256: binaryInfo.sha256,
    size: binaryInfo.size,
    sourceCommit,
    builtAt
  }
  const licenseDir = path.join(repoRoot, 'resources', 'licenses', name)
  const archive = packageRuntimeArchive({
    runtime: name,
    platform: platformKey,
    binaryPath: filePath,
    binaryName,
    metadata,
    licenseDir,
    outDir: path.join(outRoot, name, platformKey),
    sbomPath: undefined,
    signaturePath: undefined
  })

  const baseEntry = {
    platform: platformKey,
    binaryName,
    ...binaryInfo,
    filePath
  }

  return {
    name,
    version: sourceCommit,
    sourceCommit,
    supportedPlatforms: [platformKey],
    binaries: [enrichManifestEntryWithArchive(baseEntry, archive)]
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

module.exports = {
  archiveFormatForPlatform,
  packageRuntimeArchive,
  enrichManifestEntryWithArchive
}

// Only run the build pipeline (which shells out to cargo) when invoked directly,
// not when imported by tests.
if (require.main === module) {
  main()
}
