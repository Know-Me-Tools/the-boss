import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ManagedBinaryManifest, ManagedBinaryService, type ManagedBinaryTransport } from '../ManagedBinaryService'

let tempDir: string

vi.mock('node:fs', async (importOriginal) => importOriginal<typeof fs>())
vi.mock('node:os', async (importOriginal) => importOriginal<typeof os>())

describe('ManagedBinaryService', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-binary-service-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('installs and resolves a verified binary from file transport', async () => {
    const sourcePath = writeSourceBinary('test-binary', 'managed binary content')
    const manifest = createManifest(sourcePath)
    const service = createService()

    const installStatus = await service.install(manifest)
    const expectedPath = path.join(tempDir, 'managed-binaries', 'uar', '1.0.0', 'darwin-arm64', 'uar-test')

    expect(installStatus).toMatchObject({
      state: 'installed',
      binaryPath: expectedPath
    })
    expect(fs.readFileSync(expectedPath, 'utf8')).toBe('managed binary content')

    if (process.platform !== 'win32') {
      expect(fs.statSync(expectedPath).mode & 0o111).not.toBe(0)
    }

    const resolution = await service.resolveInstalledBinary(manifest)
    expect(resolution.binaryPath).toBe(expectedPath)
    expect(resolution.status.state).toBe('installed')
  })

  it('refuses hash mismatches before publishing the binary path', async () => {
    const sourcePath = writeSourceBinary('bad-binary', 'unexpected content')
    const manifest = createManifest(sourcePath, {
      maxSize: 100,
      sha256: sha256('expected content'),
      size: Buffer.byteLength('expected content')
    })
    const service = createService()

    const status = await service.install(manifest)
    const finalPath = path.join(tempDir, 'managed-binaries', 'uar', '1.0.0', 'darwin-arm64', 'uar-test')

    expect(status.state).toBe('verification-failed')
    expect(status.message).toContain('size mismatch')
    expect(fs.existsSync(finalPath)).toBe(false)

    const resolution = await service.resolveInstalledBinary(manifest)
    expect(resolution.binaryPath).toBeUndefined()
    expect(resolution.status.state).toBe('missing')
  })

  it('reports unsupported platforms without downloading', async () => {
    const sourcePath = writeSourceBinary('test-binary', 'managed binary content')
    const manifest = createManifest(sourcePath, {
      platform: 'linux-x64',
      supportedPlatforms: ['linux-x64']
    })
    const service = createService()

    const status = await service.install(manifest)

    expect(status.state).toBe('unsupported-platform')
    expect(status.message).toContain('darwin-arm64')
    expect(fs.existsSync(path.join(tempDir, 'managed-binaries', 'uar'))).toBe(false)
  })

  it('reports update available when another version is installed for the platform', async () => {
    const oldInstallDir = path.join(tempDir, 'managed-binaries', 'uar', '0.9.0', 'darwin-arm64')
    fs.mkdirSync(oldInstallDir, { recursive: true })
    fs.writeFileSync(path.join(oldInstallDir, 'uar-test'), 'old')

    const sourcePath = writeSourceBinary('test-binary', 'managed binary content')
    const manifest = createManifest(sourcePath)
    const service = createService()

    const status = await service.getStatus(manifest)

    expect(status.state).toBe('update-available')
    expect(status.binaryPath).toBe(path.join(tempDir, 'managed-binaries', 'uar', '1.0.0', 'darwin-arm64', 'uar-test'))
  })

  it('falls back from optional IPFS transport to HTTPS/file transport', async () => {
    const sourcePath = writeSourceBinary('test-binary', 'managed binary content')
    const calls: string[] = []
    const service = createService([
      {
        canDownload: (url) => url.protocol === 'ipfs:',
        download: async () => {
          calls.push('ipfs')
          throw new Error('gateway unavailable')
        }
      },
      {
        canDownload: (url) => url.protocol === 'file:',
        download: async (url, destinationPath) => {
          calls.push('file')
          fs.copyFileSync(fileURLToPath(url), destinationPath)
        }
      }
    ])

    const status = await service.install(createManifest(sourcePath, { ipfsCid: 'bafy-test-cid' }))

    expect(status.state).toBe('installed')
    expect(calls).toEqual(['ipfs', 'file'])
  })

  it('enforces max size before publishing a binary', async () => {
    const sourcePath = writeSourceBinary('too-large-binary', 'managed binary content')
    const service = createService()

    const status = await service.install(createManifest(sourcePath, { maxSize: 4 }))

    expect(status.state).toBe('download-failed')
    expect(status.message).toContain('exceeds max size')
  })
})

function createService(transports?: ManagedBinaryTransport[]): ManagedBinaryService {
  return new ManagedBinaryService({
    rootDir: path.join(tempDir, 'managed-binaries'),
    platformKey: 'darwin-arm64',
    transports
  })
}

function createManifest(
  sourcePath: string,
  overrides: Partial<ManagedBinaryManifest['binaries'][number]> & { supportedPlatforms?: string[] } = {}
): ManagedBinaryManifest {
  const content = fs.readFileSync(sourcePath)
  const platform = overrides.platform ?? 'darwin-arm64'

  return {
    name: 'uar',
    version: '1.0.0',
    sourceCommit: 'abc123',
    supportedPlatforms: overrides.supportedPlatforms ?? ['darwin-arm64'],
    binaries: [
      {
        platform,
        binaryName: 'uar-test',
        maxSize: overrides.maxSize,
        size: overrides.size ?? content.byteLength,
        sha256: overrides.sha256 ?? sha256(content),
        httpsUrl: overrides.httpsUrl ?? pathToFileURL(sourcePath).toString(),
        ipfsCid: overrides.ipfsCid,
        signatures: {
          certificateSha256: 'signature-placeholder'
        }
      }
    ]
  }
}

function writeSourceBinary(name: string, content: string): string {
  const sourcePath = path.join(tempDir, name)
  fs.writeFileSync(sourcePath, content)
  return sourcePath
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}
