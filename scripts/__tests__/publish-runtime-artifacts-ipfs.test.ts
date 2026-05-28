import { generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const { publishIpns, publishRuntimeArtifacts, readConfig } = require('../publish-runtime-artifacts-ipfs')

let tempDir: string

describe('publish-runtime-artifacts-ipfs', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-artifacts-ipfs-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('uploads binaries, writes a signed release manifest, uploads it, and writes bootstrap metadata', async () => {
    const binaryPath = writeFile('codex-darwin-arm64', 'codex binary')
    const manifestDir = path.join(tempDir, 'manifests')
    const releaseManifestPath = path.join(tempDir, 'runtime-channel-manifest.json')
    const bootstrapPath = path.join(tempDir, 'bootstrap.json')
    fs.mkdirSync(manifestDir, { recursive: true })
    fs.writeFileSync(
      path.join(manifestDir, 'codex.manifest.json'),
      `${JSON.stringify({
        name: 'codex',
        version: 'abc123',
        supportedPlatforms: ['darwin-arm64'],
        binaries: [
          {
            platform: 'darwin-arm64',
            binaryName: 'codex',
            size: Buffer.byteLength('codex binary'),
            sha256: 'a'.repeat(64),
            filePath: binaryPath
          }
        ]
      })}\n`
    )
    const requests: string[] = []
    const fetchImpl = async (url: string) => {
      requests.push(url)
      const hash = requests.length === 1 ? 'bafy-binary' : 'bafy-release-manifest'
      return createTextResponse(JSON.stringify({ Hash: hash }))
    }

    const result = await publishRuntimeArtifacts({
      manifestDir,
      fetchImpl,
      config: {
        ...createSignedConfig(),
        ipfsApiUrl: 'https://ipfs.prometheusags.ai',
        manifestPath: releaseManifestPath,
        bootstrapPath
      }
    })

    expect(requests).toEqual([
      'https://ipfs.prometheusags.ai/api/v0/add?pin=true&cid-version=1',
      'https://ipfs.prometheusags.ai/api/v0/add?pin=true&cid-version=1'
    ])
    expect(result.manifestCid).toBe('bafy-release-manifest')

    const releaseManifest = JSON.parse(fs.readFileSync(releaseManifestPath, 'utf8'))
    expect(releaseManifest).toMatchObject({
      schemaVersion: 2,
      channel: 'stable',
      manifests: [
        {
          name: 'codex',
          signature: {
            algorithm: 'ed25519',
            keyId: 'test-key'
          },
          binaries: [
            {
              ipfsCid: 'bafy-binary'
            }
          ]
        }
      ]
    })
    expect(releaseManifest.manifests[0].binaries[0]).not.toHaveProperty('filePath')

    const bootstrap = JSON.parse(fs.readFileSync(bootstrapPath, 'utf8'))
    expect(bootstrap.releaseManifestCid).toBe('bafy-release-manifest')
    expect(bootstrap.manifests[0].signature.keyId).toBe('test-key')
  })

  it('publishes release manifests to IPNS with the configured key and cache policy', async () => {
    const requests: string[] = []
    const fetchImpl = async (url: string) => {
      requests.push(url)
      return createJsonResponse({ Name: 'k51-test-key', Value: '/ipfs/bafy-release-manifest' })
    }

    const result = await publishIpns(
      'bafy-release-manifest',
      {
        ...createSignedConfig(),
        ipfsApiUrl: 'https://ipfs.prometheusags.ai',
        ipnsKey: 'runtime-channel',
        ipnsLifetime: '720h',
        ipnsTtl: '30m'
      },
      fetchImpl
    )

    expect(result).toEqual({ Name: 'k51-test-key', Value: '/ipfs/bafy-release-manifest' })
    const request = new URL(requests[0])
    expect(request.pathname).toBe('/api/v0/name/publish')
    expect(request.searchParams.get('arg')).toBe('/ipfs/bafy-release-manifest')
    expect(request.searchParams.get('key')).toBe('runtime-channel')
    expect(request.searchParams.get('resolve')).toBe('false')
    expect(request.searchParams.get('lifetime')).toBe('720h')
    expect(request.searchParams.get('ttl')).toBe('30m')
  })

  it('reads signing keys from a private-key file', () => {
    const keyPath = writeFile('runtime-key.pem', createSigningPrivateKey())

    expect(
      readConfig({
        IPFS_API_URL: 'https://ipfs.prometheusags.ai',
        RUNTIME_MANIFEST_KEY_ID: 'runtime-key',
        RUNTIME_MANIFEST_PRIVATE_KEY_PATH: keyPath
      }).signingPrivateKey
    ).toContain('PRIVATE KEY')
  })
})

function createSignedConfig() {
  return {
    ipfsApiUrl: 'https://ipfs.prometheusags.ai',
    authToken: undefined,
    channel: 'stable',
    sequence: 42,
    manifestPath: path.join(tempDir, 'runtime-channel-manifest.json'),
    bootstrapPath: path.join(tempDir, 'bootstrap.json'),
    signingKeyId: 'test-key',
    signingPrivateKey: createSigningPrivateKey(),
    ipnsKey: undefined,
    ipnsLifetime: '2160h',
    ipnsTtl: '1h'
  }
}

function createSigningPrivateKey(): string {
  return generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
}

function writeFile(name: string, content: string): string {
  const filePath = path.join(tempDir, name)
  fs.writeFileSync(filePath, content)
  return filePath
}

function createTextResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => body
  } as Response
}

function createJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response
}
