#!/usr/bin/env node

const { createPublicKey, sign } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

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
    ipnsTtl: env.IPNS_TTL || '1h'
  }
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

async function main() {
  const result = await publishRuntimeArtifacts()
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
  buildReleaseManifest,
  canonicalJson,
  publishIpns,
  publishRuntimeArtifacts,
  readConfig,
  runtimeManifestSigningPayload,
  signRuntimeManifest,
  uploadFile
}
