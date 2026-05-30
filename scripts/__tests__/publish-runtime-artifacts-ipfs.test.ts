import { generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  assertReleaseComplete,
  publishIpns,
  publishRuntimeArtifacts,
  readConfig
} = require('../publish-runtime-artifacts-ipfs')
const { requiredPlatformsFor } = require('../runtime-platform-matrix')

let tempDir: string

interface ManifestEntryOverrides {
  size?: number
  sha256?: string
  archiveSha256?: string
  archiveSize?: number
  notarization?: { notarized: boolean }
  signatures?: Record<string, string>
}

/**
 * Builds a single complete binary entry for a platform. "Complete" means it
 * carries the binary hash, the archive hash, and both sizes — i.e. it satisfies
 * the release-completeness gate by default.
 */
function buildEntry(platform: string, overrides: ManifestEntryOverrides = {}) {
  return {
    platform,
    binaryName: 'codex',
    size: overrides.size ?? 1024,
    sha256: overrides.sha256 ?? 'a'.repeat(64),
    archiveSha256: overrides.archiveSha256 ?? 'b'.repeat(64),
    archiveSize: overrides.archiveSize ?? 2048,
    ...(overrides.notarization ? { notarization: overrides.notarization } : {}),
    ...(overrides.signatures ? { signatures: overrides.signatures } : {})
  }
}

/**
 * Builds a manifest covering every required platform for the given runtime, so
 * the completeness gate passes. Pass a map of per-platform overrides to make a
 * specific entry incomplete.
 */
function buildCompleteManifest(name = 'codex', perPlatform: Record<string, ManifestEntryOverrides> = {}) {
  const platforms = requiredPlatformsFor(name)
  return {
    name,
    version: 'abc123',
    supportedPlatforms: [...platforms],
    binaries: platforms.map((platform: string) => buildEntry(platform, perPlatform[platform] ?? {}))
  }
}

describe('publish-runtime-artifacts-ipfs', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-artifacts-ipfs-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('uploads binaries, writes a signed release manifest, uploads it, and writes bootstrap metadata', async () => {
    const manifestDir = path.join(tempDir, 'manifests')
    const releaseManifestPath = path.join(tempDir, 'runtime-channel-manifest.json')
    const bootstrapPath = path.join(tempDir, 'bootstrap.json')
    fs.mkdirSync(manifestDir, { recursive: true })

    const platforms = requiredPlatformsFor('codex')
    const binaries = platforms.map((platform: string) => {
      const binaryPath = writeFile(`codex-${platform}`, `codex binary ${platform}`)
      return {
        ...buildEntry(platform, { size: Buffer.byteLength(`codex binary ${platform}`) }),
        filePath: binaryPath
      }
    })
    fs.writeFileSync(
      path.join(manifestDir, 'codex.manifest.json'),
      `${JSON.stringify({
        name: 'codex',
        version: 'abc123',
        supportedPlatforms: [...platforms],
        binaries
      })}\n`
    )

    const requests: string[] = []
    const fetchImpl = async (url: string) => {
      requests.push(url)
      // The final upload is the channel manifest itself.
      const hash = requests.length <= platforms.length ? `bafy-binary-${requests.length}` : 'bafy-release-manifest'
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

    // One upload per binary plus one for the channel manifest.
    expect(requests).toHaveLength(platforms.length + 1)
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
          }
        }
      ]
    })
    expect(releaseManifest.manifests[0].binaries[0]).toHaveProperty('ipfsCid')
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

  it('wires gate flags from env (truthy strings enable, otherwise off)', () => {
    const off = readConfig({})
    expect(off.requireSignatures).toBe(false)
    expect(off.requireMacNotarization).toBe(false)

    const on = readConfig({
      REQUIRE_ARTIFACT_SIGNATURES: 'true',
      REQUIRE_MAC_NOTARIZATION: '1'
    })
    expect(on.requireSignatures).toBe(true)
    expect(on.requireMacNotarization).toBe(true)
  })

  describe('assertReleaseComplete', () => {
    it('passes a complete fixture covering every required platform', () => {
      expect(() => assertReleaseComplete([buildCompleteManifest('codex')], {})).not.toThrow()
    })

    it('resolves display names to matrix keys', () => {
      expect(() => assertReleaseComplete([buildCompleteManifest('universal-agent-runtime')], {})).not.toThrow()
    })

    it('fails and names the missing required platform(s)', () => {
      const manifest = buildCompleteManifest('codex')
      // Drop two required platforms.
      manifest.binaries = manifest.binaries.filter(
        (b: { platform: string }) => b.platform !== 'win32-arm64' && b.platform !== 'linux-arm64'
      )

      expect(() => assertReleaseComplete([manifest], {})).toThrowError(/win32-arm64/)
      expect(() => assertReleaseComplete([manifest], {})).toThrowError(/linux-arm64/)
    })

    it('fails when an entry lacks archiveSha256', () => {
      const manifest = buildCompleteManifest('codex')
      delete (manifest.binaries[0] as Record<string, unknown>).archiveSha256

      expect(() => assertReleaseComplete([manifest], {})).toThrowError(/archiveSha256/)
      expect(() => assertReleaseComplete([manifest], {})).toThrowError(new RegExp(manifest.binaries[0].platform))
    })

    it('fails when an entry lacks size or sha256', () => {
      const manifest = buildCompleteManifest('codex')
      delete (manifest.binaries[1] as Record<string, unknown>).size
      delete (manifest.binaries[2] as Record<string, unknown>).sha256

      expect(() => assertReleaseComplete([manifest], {})).toThrowError(/size/)
      expect(() => assertReleaseComplete([manifest], {})).toThrowError(/sha256/)
    })

    it('aggregates multiple problems into a single error', () => {
      const manifest = buildCompleteManifest('codex')
      manifest.binaries = manifest.binaries.filter((b: { platform: string }) => b.platform !== 'win32-arm64')
      delete (manifest.binaries[0] as Record<string, unknown>).archiveSha256
      delete (manifest.binaries[1] as Record<string, unknown>).size

      let message = ''
      try {
        assertReleaseComplete([manifest], {})
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toMatch(/win32-arm64/)
      expect(message).toMatch(/archiveSha256/)
      expect(message).toMatch(/size/)
    })

    it('with requireMacNotarization, fails when a darwin entry lacks notarization', () => {
      const manifest = buildCompleteManifest('codex')

      expect(() => assertReleaseComplete([manifest], { requireMacNotarization: true })).toThrowError(/notari/i)
      expect(() => assertReleaseComplete([manifest], { requireMacNotarization: true })).toThrowError(/darwin-/)
    })

    it('with requireMacNotarization, passes when darwin entries are notarized', () => {
      const manifest = buildCompleteManifest('codex', {
        'darwin-arm64': { notarization: { notarized: true } },
        'darwin-x64': { notarization: { notarized: true } }
      })

      expect(() => assertReleaseComplete([manifest], { requireMacNotarization: true })).not.toThrow()
    })

    it('with requireSignatures, fails when an entry lacks signatures', () => {
      const manifest = buildCompleteManifest('codex')

      expect(() => assertReleaseComplete([manifest], { requireSignatures: true })).toThrowError(/signature/i)
    })

    it('with requireSignatures, passes when every entry has a signature', () => {
      const platforms = requiredPlatformsFor('codex')
      const perPlatform: Record<string, ManifestEntryOverrides> = {}
      for (const platform of platforms) {
        perPlatform[platform] = { signatures: { minisign: 'sig-data' } }
      }
      const manifest = buildCompleteManifest('codex', perPlatform)

      expect(() => assertReleaseComplete([manifest], { requireSignatures: true })).not.toThrow()
    })
  })

  describe('dry-run', () => {
    it('gates and summarizes without any side effects', async () => {
      const fetchImpl = vi.fn(async () => createTextResponse(JSON.stringify({ Hash: 'should-not-happen' })))
      const releaseManifestPath = path.join(tempDir, 'dry-run-manifest.json')
      const bootstrapPath = path.join(tempDir, 'dry-run-bootstrap.json')

      const summary = await publishRuntimeArtifacts({
        dryRun: true,
        manifests: [buildCompleteManifest('codex'), buildCompleteManifest('opencode')],
        fetchImpl,
        config: {
          ...createSignedConfig(),
          manifestPath: releaseManifestPath,
          bootstrapPath
        }
      })

      expect(fetchImpl).not.toHaveBeenCalled()
      expect(fs.existsSync(releaseManifestPath)).toBe(false)
      expect(fs.existsSync(bootstrapPath)).toBe(false)
      expect(summary.dryRun).toBe(true)
      expect(summary.runtimes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'codex', entryCount: 6 }),
          expect.objectContaining({ name: 'opencode', entryCount: 6 })
        ])
      )
    })

    it('dry-run still fails the gate on an incomplete release', async () => {
      const fetchImpl = vi.fn(async () => createTextResponse(JSON.stringify({ Hash: 'x' })))
      const incomplete = buildCompleteManifest('codex')
      incomplete.binaries = incomplete.binaries.filter((b: { platform: string }) => b.platform !== 'win32-x64')

      await expect(
        publishRuntimeArtifacts({
          dryRun: true,
          manifests: [incomplete],
          fetchImpl,
          config: createSignedConfig()
        })
      ).rejects.toThrow(/win32-x64/)
      expect(fetchImpl).not.toHaveBeenCalled()
    })
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
    ipnsTtl: '1h',
    requireSignatures: false,
    requireMacNotarization: false
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
