import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const { buildManifest, main, parseArgs, sha256File } = require('../build-managed-binary-manifest')

let tempDir: string

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
})

function writeBinary(name: string, content: string): string {
  const filePath = path.join(tempDir, name)
  fs.writeFileSync(filePath, content)
  return filePath
}
