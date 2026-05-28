import { generateKeyPairSync, sign } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ManagedBinaryManifest } from '../ManagedBinaryService'

const testPaths = vi.hoisted(() => ({
  resourceRoot: '',
  dataRoot: ''
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

vi.mock('node:fs', async (importOriginal) => importOriginal<typeof fs>())
vi.mock('node:os', async (importOriginal) => importOriginal<typeof os>())

vi.mock('@main/utils', () => ({
  getResourcePath: vi.fn(() => testPaths.resourceRoot),
  getDataPath: vi.fn((subPath?: string) => {
    const target = subPath ? path.join(testPaths.dataRoot, subPath) : testPaths.dataRoot
    fs.mkdirSync(target, { recursive: true })
    return target
  })
}))

import {
  ControlPlaneRuntimeManifestProvider,
  FileRuntimeManifestTrustStore,
  runtimeManifestSigningPayload
} from '../ManagedRuntimeService'

describe('ControlPlaneRuntimeManifestProvider', () => {
  let tempDir: string
  let keyPair: ReturnType<typeof createSigningKeyPair>

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-runtime-service-'))
    testPaths.resourceRoot = path.join(tempDir, 'resources')
    testPaths.dataRoot = path.join(tempDir, 'data')
    fs.mkdirSync(path.join(testPaths.resourceRoot, 'runtime-manifests'), { recursive: true })
    writeBootstrapManifest(createManifest({ name: 'codex', version: 'bootstrap', sequence: undefined }))
    keyPair = createSigningKeyPair()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('accepts a trusted signed remote manifest and stores rollback state', async () => {
    const manifest = signManifest(createManifest({ name: 'codex', version: 'remote', sequence: 7 }), keyPair)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => createJsonResponse(manifest))
    )
    const provider = createProvider()

    await expect(provider.getManifest('codex')).resolves.toMatchObject({
      name: 'codex',
      version: 'remote',
      sequence: 7
    })

    const state = JSON.parse(
      fs.readFileSync(path.join(testPaths.dataRoot, 'runtime-manifests', 'codex.state.json'), 'utf8')
    )
    const cached = JSON.parse(
      fs.readFileSync(path.join(testPaths.dataRoot, 'runtime-manifests', 'codex.verified.json'), 'utf8')
    )
    expect(state.highestSequence).toBe(7)
    expect(cached.version).toBe('remote')
  })

  it('rejects unsigned remote manifests and falls back to bootstrap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => createJsonResponse(createManifest({ name: 'codex', version: 'unsigned' })))
    )
    const provider = createProvider()

    await expect(provider.getManifest('codex')).resolves.toMatchObject({
      name: 'codex',
      version: 'bootstrap'
    })
  })

  it('rejects remote manifests signed by an unknown key', async () => {
    const unknownKeyPair = createSigningKeyPair()
    const manifest = signManifest(createManifest({ name: 'codex', version: 'unknown-key' }), unknownKeyPair)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => createJsonResponse(manifest))
    )
    const provider = createProvider()

    await expect(provider.getManifest('codex')).resolves.toMatchObject({
      name: 'codex',
      version: 'bootstrap'
    })
  })

  it('rejects expired signed manifests', async () => {
    const manifest = signManifest(
      createManifest({
        name: 'codex',
        version: 'expired',
        sequence: 3,
        expiresAt: '2026-01-01T00:00:00.000Z'
      }),
      keyPair
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => createJsonResponse(manifest))
    )
    const provider = createProvider({ now: () => new Date('2026-05-26T00:00:00.000Z') })

    await expect(provider.getManifest('codex')).resolves.toMatchObject({
      name: 'codex',
      version: 'bootstrap'
    })
  })

  it('rejects sequence rollback and keeps the last verified manifest', async () => {
    const store = new FileRuntimeManifestTrustStore(path.join(testPaths.dataRoot, 'runtime-manifests'))
    await store.setHighestSequence('codex', 10)
    await store.setLastVerifiedManifest(
      'codex',
      signManifest(createManifest({ name: 'codex', version: 'cached', sequence: 10 }), keyPair)
    )
    const rollback = signManifest(createManifest({ name: 'codex', version: 'rollback', sequence: 9 }), keyPair)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => createJsonResponse(rollback))
    )
    const provider = createProvider({ trustStore: store })

    await expect(provider.getManifest('codex')).resolves.toMatchObject({
      name: 'codex',
      version: 'cached',
      sequence: 10
    })
  })

  it('uses the last verified manifest when remote refresh fails', async () => {
    const store = new FileRuntimeManifestTrustStore(path.join(testPaths.dataRoot, 'runtime-manifests'))
    await store.setLastVerifiedManifest(
      'codex',
      signManifest(createManifest({ name: 'codex', version: 'cached', sequence: 5 }), keyPair)
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => createJsonResponse({}, false))
    )
    const provider = createProvider({ trustStore: store })

    await expect(provider.getManifest('codex')).resolves.toMatchObject({
      name: 'codex',
      version: 'cached'
    })
  })

  it('resolves signed channel manifests through IPNS gateways before control-plane fallback', async () => {
    const channelManifest = {
      schemaVersion: 2,
      channel: 'stable',
      manifests: [signManifest(createManifest({ name: 'codex', version: 'channel', sequence: 11 }), keyPair)]
    }
    const fetchMock = vi.fn(async (url: URL | string) => {
      const value = String(url)
      if (value === 'https://gateway-one.example/ipns/runtimes.prometheusags.ai') {
        return createJsonResponse({}, false)
      }
      if (value === 'https://gateway-two.example/ipns/runtimes.prometheusags.ai') {
        return createJsonResponse(channelManifest)
      }
      return createJsonResponse(createManifest({ name: 'codex', version: 'control-plane' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = createProvider({
      channelManifestName: 'runtimes.prometheusags.ai',
      channelGatewayUrls: ['https://gateway-one.example', 'https://gateway-two.example']
    })

    await expect(provider.getManifest('codex')).resolves.toMatchObject({
      name: 'codex',
      version: 'channel',
      sequence: 11
    })
    expect(fetchMock).toHaveBeenCalledWith(new URL('https://gateway-one.example/ipns/runtimes.prometheusags.ai'))
    expect(fetchMock).toHaveBeenCalledWith(new URL('https://gateway-two.example/ipns/runtimes.prometheusags.ai'))
  })

  it('uses HTTPS channel manifest fallback when IPNS gateway resolution fails', async () => {
    const channelManifest = {
      manifests: [signManifest(createManifest({ name: 'codex', version: 'https-channel', sequence: 12 }), keyPair)]
    }
    const fetchMock = vi.fn(async (url: URL | string) => {
      const value = String(url)
      if (value === 'https://runtime.example.test/channel.json') {
        return createJsonResponse(channelManifest)
      }
      return createJsonResponse({}, false)
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = createProvider({
      channelManifestName: '/ipns/runtimes.prometheusags.ai',
      channelGatewayUrls: ['https://gateway.example'],
      channelHttpsUrl: 'https://runtime.example.test/channel.json'
    })

    await expect(provider.getManifest('codex')).resolves.toMatchObject({
      name: 'codex',
      version: 'https-channel',
      sequence: 12
    })
    expect(fetchMock).toHaveBeenCalledWith(new URL('https://gateway.example/ipns/runtimes.prometheusags.ai'))
    expect(fetchMock).toHaveBeenCalledWith(new URL('https://runtime.example.test/channel.json'))
  })

  function createProvider(
    overrides: Partial<ConstructorParameters<typeof ControlPlaneRuntimeManifestProvider>[1]> = {}
  ): ControlPlaneRuntimeManifestProvider {
    return new ControlPlaneRuntimeManifestProvider('https://runtime.example.test', {
      trustKeys: [{ keyId: keyPair.keyId, publicKey: keyPair.publicKey }],
      trustStore: new FileRuntimeManifestTrustStore(path.join(testPaths.dataRoot, 'runtime-manifests')),
      ...overrides
    })
  }

  function writeBootstrapManifest(manifest: ManagedBinaryManifest): void {
    fs.writeFileSync(
      path.join(testPaths.resourceRoot, 'runtime-manifests', 'bootstrap.json'),
      `${JSON.stringify({ manifests: [manifest] }, null, 2)}\n`
    )
  }
})

function createSigningKeyPair(): { keyId: string; privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    keyId: `test-key-${Math.random().toString(16).slice(2)}`,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }
}

function createManifest({
  name,
  version,
  sequence = 1,
  expiresAt = '2026-12-31T00:00:00.000Z'
}: {
  name: ManagedBinaryManifest['name']
  version: string
  sequence?: number
  expiresAt?: string
}): ManagedBinaryManifest {
  return {
    schemaVersion: 2,
    name,
    version,
    channel: 'stable',
    sequence,
    expiresAt,
    sourceCommit: version,
    supportedPlatforms: ['darwin-arm64'],
    binaries: [
      {
        platform: 'darwin-arm64',
        binaryName: name === 'universal-agent-runtime' ? 'universal-agent-runtime' : name,
        size: 10,
        maxSize: 20,
        sha256: 'a'.repeat(64),
        ipfsCid: `bafy-${version}`
      }
    ]
  }
}

function signManifest(
  manifest: ManagedBinaryManifest,
  keyPair: { keyId: string; privateKey: string }
): ManagedBinaryManifest {
  return {
    ...manifest,
    signature: {
      algorithm: 'ed25519',
      keyId: keyPair.keyId,
      value: sign(null, Buffer.from(runtimeManifestSigningPayload(manifest)), keyPair.privateKey).toString('base64')
    }
  }
}

function createJsonResponse(value: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 503,
    json: async () => value
  } as Response
}
