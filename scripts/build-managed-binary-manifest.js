const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { validateManifest } = require('./runtime-manifest-schema')
const { isPlatformSupported, RUNTIME_KEYS } = require('./runtime-platform-matrix')

/**
 * Merge N per-platform manifests for the SAME runtime into one per-runtime
 * manifest. In CI each platform builds independently, emitting e.g.
 * `uar.darwin-arm64.manifest.json` and `uar.linux-x64.manifest.json`; this
 * combines them into a single `uar.manifest.json`.
 *
 * Channel-level fields (schemaVersion, channel, sequence, publishedAt,
 * expiresAt, min/maxAppVersion, revokedArtifacts, signature) are intentionally
 * NOT carried into the merged manifest: those are per-channel and are added by
 * the separate publish/signing step. Merging only combines the per-platform
 * facts (name, version, sourceCommit, binaries, supportedPlatforms) so the
 * merge step can never fabricate a signature.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} manifests
 * @returns {ReturnType<typeof validateManifest>}
 */
function mergeManifests(manifests) {
  if (!Array.isArray(manifests) || manifests.length === 0) {
    throw new Error('mergeManifests requires at least one input manifest')
  }

  const [first] = manifests
  const name = first.name
  const version = first.version
  const sourceCommit = first.sourceCommit

  for (const manifest of manifests) {
    if (manifest.name !== name) {
      throw new Error(`Cannot merge manifests with mismatched name: "${String(name)}" vs "${String(manifest.name)}"`)
    }
    if (manifest.version !== version) {
      throw new Error(
        `Cannot merge manifests with mismatched version: "${String(version)}" vs "${String(manifest.version)}"`
      )
    }
    if (manifest.sourceCommit !== sourceCommit) {
      throw new Error(
        `Cannot merge manifests with mismatched sourceCommit: "${String(sourceCommit)}" vs "${String(manifest.sourceCommit)}" — all inputs must come from the same release build`
      )
    }
  }

  const binaries = []
  const seenPlatforms = new Set()
  // Only validate against the matrix when the manifest name is a known runtime
  // key (the matrix is keyed by 'uar'/'opencode'/'codex', not by display name).
  const enforceMatrix = RUNTIME_KEYS.includes(name)

  for (const manifest of manifests) {
    const entries = Array.isArray(manifest.binaries) ? manifest.binaries : []
    for (const entry of entries) {
      const platform = entry.platform
      if (seenPlatforms.has(platform)) {
        throw new Error(
          `Cannot merge manifests: duplicate platform "${String(platform)}" appears in more than one input`
        )
      }
      if (enforceMatrix && !isPlatformSupported(name, platform)) {
        throw new Error(`Cannot merge manifests: platform "${String(platform)}" is not supported by runtime "${name}"`)
      }
      seenPlatforms.add(platform)
      binaries.push(entry)
    }
  }

  const supportedPlatforms = [...seenPlatforms].sort()

  const merged = {
    name,
    version,
    ...(sourceCommit ? { sourceCommit } : {}),
    supportedPlatforms,
    binaries
  }

  return validateManifest(merged)
}

function buildManifest(options) {
  const binaries = options.binaries.map((binary) => buildManifestEntry(binary))
  const manifest = {
    name: options.name,
    version: options.version,
    ...(options.sourceCommit ? { sourceCommit: options.sourceCommit } : {}),
    supportedPlatforms: binaries.map((binary) => binary.platform),
    binaries
  }
  // Fail fast at build time if the assembled manifest is malformed, and return
  // the validated/normalized object so the written manifest matches the schema.
  return validateManifest(manifest)
}

function buildManifestEntry(binary) {
  const stats = fs.statSync(binary.filePath)
  return {
    platform: binary.platform,
    binaryName: binary.binaryName ?? path.basename(binary.filePath),
    size: stats.size,
    maxSize: binary.maxSize ?? stats.size,
    sha256: sha256File(binary.filePath),
    ...(binary.httpsUrl ? { httpsUrl: binary.httpsUrl } : {}),
    ...(binary.ipfsCid ? { ipfsCid: binary.ipfsCid } : {}),
    ...(binary.archiveName ? { archiveName: binary.archiveName } : {}),
    ...(binary.archiveSha256 ? { archiveSha256: binary.archiveSha256 } : {}),
    ...(binary.archiveSize != null ? { archiveSize: binary.archiveSize } : {}),
    ...(binary.archiveFormat ? { archiveFormat: binary.archiveFormat } : {}),
    ...(binary.signingIdentity ? { signingIdentity: binary.signingIdentity } : {}),
    ...(binary.teamId ? { teamId: binary.teamId } : {}),
    ...(binary.notarization ? { notarization: binary.notarization } : {}),
    ...(binary.signatures ? { signatures: binary.signatures } : {})
  }
}

function parseArgs(argv) {
  if (argv.includes('--merge')) {
    return parseMergeArgs(argv)
  }

  const options = {
    binaries: [],
    httpsUrls: new Map(),
    ipfsCids: new Map()
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    if (arg === '--name') {
      options.name = value
      index += 1
    } else if (arg === '--version') {
      options.version = value
      index += 1
    } else if (arg === '--source-commit') {
      options.sourceCommit = value
      index += 1
    } else if (arg === '--out') {
      options.out = value
      index += 1
    } else if (arg === '--binary') {
      const parsed = parsePlatformValue(value, '--binary')
      options.binaries.push({
        platform: parsed.platform,
        filePath: parsed.value
      })
      index += 1
    } else if (arg === '--https-url') {
      const parsed = parsePlatformValue(value, '--https-url')
      options.httpsUrls.set(parsed.platform, parsed.value)
      index += 1
    } else if (arg === '--ipfs-cid') {
      const parsed = parsePlatformValue(value, '--ipfs-cid')
      options.ipfsCids.set(parsed.platform, parsed.value)
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!options.name || !options.version || options.binaries.length === 0) {
    throw new Error('Usage: --name <name> --version <version> --binary <platform=path> [--out manifest.json]')
  }

  return {
    name: options.name,
    version: options.version,
    sourceCommit: options.sourceCommit,
    out: options.out,
    binaries: options.binaries.map((binary) => ({
      ...binary,
      httpsUrl: options.httpsUrls.get(binary.platform),
      ipfsCid: options.ipfsCids.get(binary.platform)
    }))
  }
}

function parseMergeArgs(argv) {
  const inputs = []
  let out

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    if (arg === '--merge') {
      continue
    } else if (arg === '--input') {
      if (!value) {
        throw new Error('--input expects a manifest file path')
      }
      inputs.push(value)
      index += 1
    } else if (arg === '--out') {
      out = value
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (inputs.length === 0) {
    throw new Error('Usage: --merge --input <manifest.json> [--input <manifest.json> ...] [--out manifest.json]')
  }

  return { merge: true, inputs, out }
}

function parsePlatformValue(value, flag) {
  const separator = value?.indexOf('=')
  if (!value || separator <= 0 || separator === value.length - 1) {
    throw new Error(`${flag} expects <platform=value>`)
  }

  return {
    platform: value.slice(0, separator),
    value: value.slice(separator + 1)
  }
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const manifest = options.merge
    ? mergeManifests(options.inputs.map((input) => JSON.parse(fs.readFileSync(input, 'utf8'))))
    : buildManifest(options)
  const json = `${JSON.stringify(manifest, null, 2)}\n`
  if (options.out) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true })
    fs.writeFileSync(options.out, json)
  } else {
    process.stdout.write(json)
  }
  return manifest
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  buildManifest,
  buildManifestEntry,
  main,
  mergeManifests,
  parseArgs,
  sha256File
}
