import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const { buildManifest, buildManifestEntry, main, parseArgs, sha256File } = require('../build-managed-binary-manifest')
const { validateManifest, validateManifestEntry } = require('../runtime-manifest-schema')

let tempDir: string

const VALID_SHA256 = 'a'.repeat(64)

describe('build-managed-binary-manifest', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-binary-manifest-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true })
  })

  it('emits per-platform manifest entries with hashes and optional CID fields', () => {
    const binaryPath = writeBinary('uar-darwin-arm64', 'managed binary content')

    const manifest = buildManifest({
      name: 'universal-agent-runtime',
      version: 'abc123',
      sourceCommit: 'abc123',
      binaries: [
        {
          platform: 'darwin-arm64',
          filePath: binaryPath,
          httpsUrl: 'https://example.com/uar-darwin-arm64',
          ipfsCid: 'bafy-test-cid'
        }
      ]
    })

    expect(manifest).toEqual({
      name: 'universal-agent-runtime',
      version: 'abc123',
      sourceCommit: 'abc123',
      supportedPlatforms: ['darwin-arm64'],
      binaries: [
        expect.objectContaining({
          platform: 'darwin-arm64',
          binaryName: 'uar-darwin-arm64',
          size: Buffer.byteLength('managed binary content'),
          maxSize: Buffer.byteLength('managed binary content'),
          sha256: sha256File(binaryPath),
          httpsUrl: 'https://example.com/uar-darwin-arm64',
          ipfsCid: 'bafy-test-cid'
        })
      ]
    })
  })

  it('parses platform-scoped release inputs and writes a manifest file', () => {
    const binaryPath = writeBinary('rtk-darwin-arm64', 'rtk binary')
    const outPath = path.join(tempDir, 'manifest.json')

    const options = parseArgs([
      '--name',
      'rtk',
      '--version',
      '1.0.0',
      '--binary',
      `darwin-arm64=${binaryPath}`,
      '--https-url',
      'darwin-arm64=https://example.com/rtk-darwin-arm64',
      '--out',
      outPath
    ])

    expect(options.binaries[0]).toMatchObject({
      platform: 'darwin-arm64',
      filePath: binaryPath,
      httpsUrl: 'https://example.com/rtk-darwin-arm64'
    })

    main([
      '--name',
      'rtk',
      '--version',
      '1.0.0',
      '--binary',
      `darwin-arm64=${binaryPath}`,
      '--https-url',
      'darwin-arm64=https://example.com/rtk-darwin-arm64',
      '--out',
      outPath
    ])

    expect(JSON.parse(fs.readFileSync(outPath, 'utf8'))).toMatchObject({
      name: 'rtk',
      version: '1.0.0',
      supportedPlatforms: ['darwin-arm64']
    })
  })

  it('round-trips archive, signing, and notarization fields through buildManifestEntry and validates', () => {
    const binaryPath = writeBinary('uar-darwin-arm64', 'managed binary content')

    const entry = buildManifestEntry({
      platform: 'darwin-arm64',
      filePath: binaryPath,
      archiveName: 'universal-agent-runtime-darwin-arm64.tar.zst',
      archiveSha256: VALID_SHA256,
      archiveSize: 4096,
      archiveFormat: 'tar.zst',
      signingIdentity: 'Developer ID Application: Example (TEAM123)',
      teamId: 'TEAM123',
      notarization: { notarized: true, ticketId: 'ticket-abc' },
      signatures: { minisign: 'RW...', certificateSha256: 'b'.repeat(64) }
    })

    expect(entry).toMatchObject({
      platform: 'darwin-arm64',
      binaryName: 'uar-darwin-arm64',
      archiveName: 'universal-agent-runtime-darwin-arm64.tar.zst',
      archiveSha256: VALID_SHA256,
      archiveSize: 4096,
      archiveFormat: 'tar.zst',
      signingIdentity: 'Developer ID Application: Example (TEAM123)',
      teamId: 'TEAM123',
      notarization: { notarized: true, ticketId: 'ticket-abc' },
      signatures: { minisign: 'RW...', certificateSha256: 'b'.repeat(64) }
    })

    expect(() => validateManifestEntry(entry)).not.toThrow()
  })

  it('accepts a minimal valid manifest with only the pre-existing field set', () => {
    const manifest = {
      name: 'universal-agent-runtime',
      version: 'abc123',
      supportedPlatforms: ['darwin-arm64'],
      binaries: [
        {
          platform: 'darwin-arm64',
          binaryName: 'uar-darwin-arm64',
          size: 1024,
          sha256: VALID_SHA256
        }
      ]
    }

    expect(() => validateManifest(manifest)).not.toThrow()
  })

  it('rejects a manifest with a malformed sha256', () => {
    expect(() =>
      validateManifest({
        name: 'uar',
        version: '1.0.0',
        supportedPlatforms: ['darwin-arm64'],
        binaries: [{ platform: 'darwin-arm64', binaryName: 'uar', size: 1, sha256: 'too-short' }]
      })
    ).toThrow(/sha256/i)
  })

  it('rejects a manifest with a missing required field', () => {
    expect(() =>
      validateManifest({
        version: '1.0.0',
        supportedPlatforms: ['darwin-arm64'],
        binaries: [{ platform: 'darwin-arm64', binaryName: 'uar', size: 1, sha256: VALID_SHA256 }]
      })
    ).toThrow(/name/i)
  })

  it('rejects a manifest with a non-positive size', () => {
    expect(() =>
      validateManifest({
        name: 'uar',
        version: '1.0.0',
        supportedPlatforms: ['darwin-arm64'],
        binaries: [{ platform: 'darwin-arm64', binaryName: 'uar', size: -1, sha256: VALID_SHA256 }]
      })
    ).toThrow(/size/i)
  })

  it('rejects a manifest with empty binaries', () => {
    expect(() =>
      validateManifest({
        name: 'uar',
        version: '1.0.0',
        supportedPlatforms: [],
        binaries: []
      })
    ).toThrow(/binaries/i)
  })

  it('rejects an unknown archiveFormat', () => {
    expect(() =>
      validateManifestEntry({
        platform: 'darwin-arm64',
        binaryName: 'uar',
        size: 1,
        sha256: VALID_SHA256,
        archiveFormat: 'rar'
      })
    ).toThrow(/archiveFormat|tar\.zst|zip/i)
  })

  it('preserves channel-level fields (sequence, signature, expiresAt, revokedArtifacts) through validateManifest', () => {
    const manifest = {
      schemaVersion: 1,
      channel: 'stable',
      sequence: 7,
      publishedAt: '2026-01-01T00:00:00Z',
      expiresAt: '2027-01-01T00:00:00Z',
      minAppVersion: '1.9.0',
      maxAppVersion: '2.0.0',
      revokedArtifacts: ['c'.repeat(64), 'bafy-revoked-cid'],
      signature: { algorithm: 'ed25519', keyId: 'key-1', value: 'sig-value' },
      name: 'universal-agent-runtime',
      version: 'abc123',
      sourceCommit: 'abc123',
      supportedPlatforms: ['darwin-arm64'],
      binaries: [{ platform: 'darwin-arm64', binaryName: 'uar', size: 1024, sha256: VALID_SHA256 }]
    }

    const validated = validateManifest(manifest)

    // These channel-level fields are read by assertRuntimeManifestTrusted; if the
    // schema stripped them a signed manifest would be treated as unsigned.
    expect(validated).toMatchObject({
      schemaVersion: 1,
      channel: 'stable',
      sequence: 7,
      publishedAt: '2026-01-01T00:00:00Z',
      expiresAt: '2027-01-01T00:00:00Z',
      minAppVersion: '1.9.0',
      maxAppVersion: '2.0.0',
      revokedArtifacts: ['c'.repeat(64), 'bafy-revoked-cid'],
      signature: { algorithm: 'ed25519', keyId: 'key-1', value: 'sig-value' }
    })
  })

  it('accepts tar.zst and zip archive formats', () => {
    for (const archiveFormat of ['tar.zst', 'zip']) {
      expect(() =>
        validateManifestEntry({
          platform: 'darwin-arm64',
          binaryName: 'uar',
          size: 1,
          sha256: VALID_SHA256,
          archiveFormat
        })
      ).not.toThrow()
    }
  })
})

function writeBinary(name: string, content: string): string {
  const filePath = path.join(tempDir, name)
  fs.writeFileSync(filePath, content)
  return filePath
}
