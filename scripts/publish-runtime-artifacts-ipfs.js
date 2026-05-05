#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const manifestDir = path.join(repoRoot, 'dist', 'runtime-artifacts')
const bootstrapPath = path.join(repoRoot, 'resources', 'runtime-manifests', 'bootstrap.json')
const ipfsApiUrl = (process.env.IPFS_API_URL || 'https://ipfs.prometheusags.ai').replace(/\/+$/, '')

async function uploadFile(filePath) {
  const form = new FormData()
  const blob = new Blob([fs.readFileSync(filePath)])
  form.set('file', blob, path.basename(filePath))

  const headers = {}
  if (process.env.IPFS_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${process.env.IPFS_AUTH_TOKEN}`
  }

  const response = await fetch(`${ipfsApiUrl}/api/v0/add?pin=true&cid-version=1`, {
    method: 'POST',
    headers,
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

async function main() {
  const manifests = fs
    .readdirSync(manifestDir)
    .filter((name) => name.endsWith('.manifest.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(manifestDir, name), 'utf8')))

  for (const manifest of manifests) {
    for (const binary of manifest.binaries) {
      if (!binary.filePath) {
        continue
      }
      binary.ipfsCid = await uploadFile(binary.filePath)
      delete binary.filePath
    }
  }

  const bootstrap = {
    schemaVersion: 1,
    channel: 'bootstrap',
    generatedAt: new Date().toISOString(),
    manifests
  }
  fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true })
  fs.writeFileSync(bootstrapPath, `${JSON.stringify(bootstrap, null, 2)}\n`)
  console.log(`Bootstrap runtime manifest written to ${path.relative(repoRoot, bootstrapPath)}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
