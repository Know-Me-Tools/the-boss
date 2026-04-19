const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

function buildManifest(options) {
  const binaries = options.binaries.map((binary) => buildManifestEntry(binary))
  return {
    name: options.name,
    version: options.version,
    ...(options.sourceCommit ? { sourceCommit: options.sourceCommit } : {}),
    supportedPlatforms: binaries.map((binary) => binary.platform),
    binaries
  }
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
    ...(binary.signatures ? { signatures: binary.signatures } : {})
  }
}

function parseArgs(argv) {
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
  const manifest = buildManifest(options)
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
  parseArgs,
  sha256File
}
