#!/usr/bin/env node

const { createPublicKey, sign } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { resolveRuntimeKey, requiredPlatformsFor } = require('./runtime-platform-matrix')

const repoRoot = path.resolve(__dirname, '..')
const manifestDir = path.join(repoRoot, 'dist', 'runtime-artifacts')
const bootstrapPath = path.join(repoRoot, 'resources', 'runtime-manifests', 'bootstrap.json')
const releaseManifestPath = path.join(manifestDir, 'runtime-channel-manifest.json')

function readConfig(env = process.env) {
  return {
    ipfsApiUrl: (env.IPFS_API_URL || 'https://ipfs.prometheusags.ai').replace(/\/+$/, ''),
    authToken: env.IPFS_AUTH_TOKEN,
    channel: env.RUNTIME_MANIFEST_CHANNEL || 'stable',
    sequence: Number(env.RUNTIME_MANIFEST_SEQUENCE || Date.now()),
    manifestPath: env.RUNTIME_MANIFEST_OUT || releaseManifestPath,
    bootstrapPath: env.RUNTIME_BOOTSTRAP_OUT || bootstrapPath,
    signingKeyId: env.RUNTIME_MANIFEST_KEY_ID,
    signingPrivateKey: readSigningPrivateKey(env),
    ipnsKey: env.IPNS_KEY,
    ipnsLifetime: env.IPNS_LIFETIME || '2160h',
    ipnsTtl: env.IPNS_TTL || '1h',
    // Release-completeness gate flags. Both default OFF: per-artifact detached
    // signatures and macOS notarization metadata land in CI, so local/dev
    // publishes are not blocked on them. CI opts in by setting the env flags to
    // a truthy string (e.g. 'true' or '1').
    requireSignatures: isTruthy(env.REQUIRE_ARTIFACT_SIGNATURES),
    requireMacNotarization: isTruthy(env.REQUIRE_MAC_NOTARIZATION)
  }
}

/**
 * Treats a string env value as truthy when it is a non-empty, non-"false"/"0"
 * value. Unset (undefined) is falsy.
 *
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isTruthy(value) {
  if (typeof value !== 'string') {
    return false
  }
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== 'false' && normalized !== '0' && normalized !== 'no'
}

function readSigningPrivateKey(env) {
  if (env.RUNTIME_MANIFEST_PRIVATE_KEY) {
    return env.RUNTIME_MANIFEST_PRIVATE_KEY
  }
  if (env.RUNTIME_MANIFEST_PRIVATE_KEY_PATH) {
    return fs.readFileSync(env.RUNTIME_MANIFEST_PRIVATE_KEY_PATH, 'utf8')
  }
  return undefined
}

function authHeaders(config) {
  const headers = {}
  if (config.authToken) {
    headers.Authorization = `Bearer ${config.authToken}`
  }
  return headers
}

async function uploadFile(filePath, config = readConfig(), fetchImpl = fetch) {
  const form = new FormData()
  const blob = new Blob([fs.readFileSync(filePath)])
  form.set('file', blob, path.basename(filePath))

  const response = await fetchImpl(`${config.ipfsApiUrl}/api/v0/add?pin=true&cid-version=1`, {
    method: 'POST',
    headers: authHeaders(config),
    body: form
  })
  if (!response.ok) {
    throw new Error(`IPFS upload failed for ${filePath}: HTTP ${response.status} ${await response.text()}`)
  }

  const lines = (await response.text()).trim().split('\n').filter(Boolean)
  const last = JSON.parse(lines.at(-1))
  if (!last.Hash) {
    throw new Error(`IPFS upload response did not include Hash for ${filePath}`)
  }
  return last.Hash
}

async function publishIpns(manifestCid, config = readConfig(), fetchImpl = fetch) {
  if (!config.ipnsKey) {
    return null
  }

  const params = new URLSearchParams({
    arg: `/ipfs/${manifestCid}`,
    key: config.ipnsKey,
    resolve: 'false',
    lifetime: config.ipnsLifetime,
    ttl: config.ipnsTtl
  })
  const response = await fetchImpl(`${config.ipfsApiUrl}/api/v0/name/publish?${params.toString()}`, {
    method: 'POST',
    headers: authHeaders(config)
  })
  if (!response.ok) {
    throw new Error(`IPNS publish failed for ${manifestCid}: HTTP ${response.status} ${await response.text()}`)
  }

  return response.json()
}

function loadRuntimeManifests(dir = manifestDir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.manifest.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
}

function buildReleaseManifest(manifests, config = readConfig()) {
  const releaseManifest = {
    schemaVersion: 2,
    channel: config.channel,
    sequence: config.sequence,
    publishedAt: new Date().toISOString(),
    manifests
  }

  return {
    ...releaseManifest,
    manifests: manifests.map((manifest) => signRuntimeManifest(manifest, config))
  }
}

function signRuntimeManifest(manifest, config = readConfig()) {
  if (!config.signingKeyId || !config.signingPrivateKey) {
    return manifest
  }

  const enriched = {
    schemaVersion: manifest.schemaVersion ?? 2,
    channel: manifest.channel ?? config.channel,
    sequence: manifest.sequence ?? config.sequence,
    publishedAt: manifest.publishedAt ?? new Date().toISOString(),
    ...manifest
  }
  return {
    ...enriched,
    signature: {
      algorithm: 'ed25519',
      keyId: config.signingKeyId,
      value: sign(null, Buffer.from(runtimeManifestSigningPayload(enriched)), config.signingPrivateKey).toString(
        'base64'
      )
    }
  }
}

function runtimeManifestSigningPayload(manifest) {
  const unsignedManifest = { ...manifest }
  delete unsignedManifest.signature
  return canonicalJson(unsignedManifest)
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }

  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`
}

/**
 * Validates that a runtime release is COMPLETE before it is signed and
 * published. Aggregates every problem found across all manifests and throws a
 * single error listing them, grouped by runtime/platform, so an operator can
 * fix everything in one pass instead of discovering issues one at a time.
 *
 * Checks per runtime manifest:
 *  1. Required platforms — for runtimes recognized by the platform matrix,
 *     every required platform must have a binary entry.
 *  2. Artifact metadata — each entry must carry sha256 (binary hash),
 *     archiveSha256 (archive hash), size, and archiveSize.
 *  3. Signatures (only when options.requireSignatures) — each entry must have a
 *     `signatures` object with at least one signature.
 *  4. macOS notarization (only when options.requireMacNotarization) — each
 *     darwin-* entry must have `notarization.notarized === true`.
 *
 * @param {Array<object>} manifests
 * @param {{ requireSignatures?: boolean, requireMacNotarization?: boolean }} [options]
 * @returns {{ runtimes: Array<{ name: string, runtimeKey: string | undefined, platforms: string[], entryCount: number }> }}
 */
function assertReleaseComplete(manifests, options = {}) {
  const requireSignatures = options.requireSignatures === true
  const requireMacNotarization = options.requireMacNotarization === true

  const problems = []
  const summaryRuntimes = []

  for (const manifest of manifests) {
    const name = manifest?.name ?? '(unnamed)'
    const runtimeKey = resolveRuntimeKey(name)
    const binaries = Array.isArray(manifest?.binaries) ? manifest.binaries : []
    const presentPlatforms = new Set(binaries.map((binary) => binary?.platform).filter(Boolean))

    // 1. Required platforms (recognized runtimes only).
    if (runtimeKey) {
      const missing = requiredPlatformsFor(runtimeKey).filter((platform) => !presentPlatforms.has(platform))
      for (const platform of missing) {
        problems.push(`[${name}] missing required platform: ${platform}`)
      }
    }

    // 2/3/4. Per-entry checks.
    for (const binary of binaries) {
      const platform = binary?.platform ?? '(unknown-platform)'
      const where = `[${name}/${platform}]`

      if (!binary?.sha256) {
        problems.push(`${where} missing binary sha256`)
      }
      if (binary?.size === undefined || binary?.size === null) {
        problems.push(`${where} missing size`)
      }
      if (!binary?.archiveSha256) {
        problems.push(`${where} missing archiveSha256`)
      }
      if (binary?.archiveSize === undefined || binary?.archiveSize === null) {
        problems.push(`${where} missing archiveSize`)
      }

      if (requireSignatures) {
        const signatures = binary?.signatures
        const hasSignature = signatures && typeof signatures === 'object' && Object.values(signatures).some(Boolean)
        if (!hasSignature) {
          problems.push(`${where} missing artifact signature (signatures.* required)`)
        }
      }

      if (requireMacNotarization && typeof platform === 'string' && platform.startsWith('darwin-')) {
        if (binary?.notarization?.notarized !== true) {
          problems.push(`${where} missing macOS notarization (notarization.notarized must be true)`)
        }
      }
    }

    summaryRuntimes.push({
      name,
      runtimeKey,
      platforms: [...presentPlatforms],
      entryCount: binaries.length
    })
  }

  if (problems.length > 0) {
    throw new Error(
      `Release is incomplete; cannot publish. ${problems.length} problem(s) found:\n${problems
        .map((problem) => `  - ${problem}`)
        .join('\n')}`
    )
  }

  return { runtimes: summaryRuntimes }
}

function assertSigningKey(config) {
  if (!config.signingKeyId || !config.signingPrivateKey) {
    throw new Error(
      'Runtime manifest signing requires RUNTIME_MANIFEST_KEY_ID and RUNTIME_MANIFEST_PRIVATE_KEY or RUNTIME_MANIFEST_PRIVATE_KEY_PATH.'
    )
  }
  createPublicKey(config.signingPrivateKey)
}

async function publishRuntimeArtifacts(options = {}) {
  const config = options.config ?? readConfig(options.env)
  const fetchImpl = options.fetchImpl ?? fetch
  const manifests = options.manifests ?? loadRuntimeManifests(options.manifestDir ?? manifestDir)
  const dryRun = options.dryRun === true

  // Gate the release BEFORE any signing or upload side effects. Throws (with all
  // problems aggregated) if the release is incomplete.
  const gate = assertReleaseComplete(manifests, {
    requireSignatures: config.requireSignatures === true,
    requireMacNotarization: config.requireMacNotarization === true
  })

  if (dryRun) {
    return {
      dryRun: true,
      channel: config.channel,
      sequence: config.sequence,
      runtimes: gate.runtimes,
      manifestCount: manifests.length,
      entryCount: gate.runtimes.reduce((total, runtime) => total + runtime.entryCount, 0)
    }
  }

  assertSigningKey(config)
  for (const manifest of manifests) {
    for (const binary of manifest.binaries) {
      if (!binary.filePath) {
        continue
      }
      binary.ipfsCid = await uploadFile(binary.filePath, config, fetchImpl)
      delete binary.filePath
    }
  }

  const releaseManifest = buildReleaseManifest(manifests, config)
  fs.mkdirSync(path.dirname(config.manifestPath), { recursive: true })
  fs.writeFileSync(config.manifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`)

  const manifestCid = await uploadFile(config.manifestPath, config, fetchImpl)
  const ipns = await publishIpns(manifestCid, config, fetchImpl)

  const bootstrap = {
    schemaVersion: 1,
    channel: 'bootstrap',
    generatedAt: new Date().toISOString(),
    releaseManifestCid: manifestCid,
    ...(ipns?.Name ? { releaseManifestIpns: `/ipns/${ipns.Name}` } : {}),
    manifests: releaseManifest.manifests
  }
  fs.mkdirSync(path.dirname(config.bootstrapPath), { recursive: true })
  fs.writeFileSync(config.bootstrapPath, `${JSON.stringify(bootstrap, null, 2)}\n`)

  return {
    bootstrap,
    releaseManifest,
    manifestCid,
    ipns
  }
}

async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run')
  const result = await publishRuntimeArtifacts({ dryRun })

  if (result.dryRun) {
    console.log(
      `[dry-run] Release gate PASSED. Would publish channel "${result.channel}" (sequence ${result.sequence}).`
    )
    console.log(`[dry-run] ${result.manifestCount} runtime(s), ${result.entryCount} binary entr(ies):`)
    for (const runtime of result.runtimes) {
      console.log(`[dry-run]   - ${runtime.name}: ${runtime.entryCount} platform(s) [${runtime.platforms.join(', ')}]`)
    }
    console.log('[dry-run] No artifacts uploaded, no manifest signed/written, no IPNS published.')
    return
  }

  console.log(`Release runtime manifest written to ${path.relative(repoRoot, readConfig().manifestPath)}`)
  console.log(`Release runtime manifest uploaded to IPFS CID ${result.manifestCid}`)
  if (result.ipns?.Name) {
    console.log(`Release runtime manifest published to /ipns/${result.ipns.Name}`)
  }
  console.log(`Bootstrap runtime manifest written to ${path.relative(repoRoot, readConfig().bootstrapPath)}`)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

module.exports = {
  assertReleaseComplete,
  buildReleaseManifest,
  canonicalJson,
  publishIpns,
  publishRuntimeArtifacts,
  readConfig,
  runtimeManifestSigningPayload,
  signRuntimeManifest,
  uploadFile
}
