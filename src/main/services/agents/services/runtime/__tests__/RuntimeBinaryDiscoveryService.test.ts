import fs from 'node:fs/promises'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readRuntimeCommand, RuntimeBinaryDiscoveryService } from '../RuntimeBinaryDiscoveryService'

describe('RuntimeBinaryDiscoveryService', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'runtime-discovery-'))
  })

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('maps supported runtime kinds to PATH command names', () => {
    expect(readRuntimeCommand('codex')).toBe('codex')
    expect(readRuntimeCommand('opencode')).toBe('opencode')
    expect(readRuntimeCommand('uar')).toBe('universal-agent-runtime')
    expect(readRuntimeCommand('claude')).toBeUndefined()
  })

  it('reports unavailable when the command cannot be found', async () => {
    const service = new RuntimeBinaryDiscoveryService({
      findExecutable: vi.fn(async () => null)
    })

    await expect(service.discover('codex')).resolves.toEqual(
      expect.objectContaining({
        kind: 'codex',
        command: 'codex',
        available: false,
        message: 'codex was not found on PATH.'
      })
    )
  })

  it('reports a detected executable file with a version when available', async () => {
    const binaryPath = path.join(tempDir, 'opencode')
    await fs.writeFile(binaryPath, '#!/bin/sh\n', 'utf8')
    const service = new RuntimeBinaryDiscoveryService({
      findExecutable: vi.fn(async () => binaryPath),
      readVersion: vi.fn(async () => 'opencode 1.0.0')
    })

    await expect(service.discover('opencode')).resolves.toEqual(
      expect.objectContaining({
        kind: 'opencode',
        command: 'opencode',
        detectedPath: binaryPath,
        version: 'opencode 1.0.0',
        source: 'path',
        available: true,
        message: expect.stringContaining('opencode was detected on PATH')
      })
    )
  })

  it('rejects PATH matches that are not files', async () => {
    const detectedPath = path.join(tempDir, 'universal-agent-runtime')
    await fs.mkdir(detectedPath)
    const service = new RuntimeBinaryDiscoveryService({
      findExecutable: vi.fn(async () => detectedPath)
    })

    await expect(service.discover('uar')).resolves.toEqual(
      expect.objectContaining({
        kind: 'uar',
        command: 'universal-agent-runtime',
        detectedPath,
        available: false,
        message: expect.stringContaining('is not a file')
      })
    )
  })
})
