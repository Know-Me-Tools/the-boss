import { describe, expect, it, vi } from 'vitest'

const { signAndNotarizeMacArtifact, applySigningMetadataToEntry } = require('../sign-runtime-artifact')
const { validateManifestEntry } = require('../runtime-manifest-schema')

const SILENT_LOGGER = { log: () => {}, warn: () => {}, error: () => {} }

const macCreds = {
  APPLE_SIGNING_IDENTITY: 'Developer ID Application: Example Corp (TEAM123456)',
  APPLE_TEAM_ID: 'TEAM123456',
  APPLE_ID: 'dev@example.com',
  APPLE_APP_SPECIFIC_PASSWORD: 'abcd-efgh-ijkl-mnop'
}

const BIN = '/tmp/runtime/codex'

describe('signAndNotarizeMacArtifact', () => {
  it('no-ops on non-macOS platforms without invoking the signer', async () => {
    const signer = vi.fn(() => ({ success: true }))
    const notarizer = vi.fn(async () => ({ ticketId: 'x' }))

    const result = await signAndNotarizeMacArtifact({
      binaryPath: BIN,
      platform: 'linux-x64',
      env: { ...macCreds },
      signer,
      notarizer,
      logger: SILENT_LOGGER
    })

    expect(result).toEqual({ signed: false, notarized: false, reason: 'not-macos' })
    expect(signer).not.toHaveBeenCalled()
    expect(notarizer).not.toHaveBeenCalled()
  })

  it('skips (no-op) on macOS when credentials are absent and logs a skip', async () => {
    const signer = vi.fn(() => ({ success: true }))
    const notarizer = vi.fn(async () => ({ ticketId: 'x' }))
    const log = vi.fn()

    const result = await signAndNotarizeMacArtifact({
      binaryPath: BIN,
      platform: 'darwin-arm64',
      env: {},
      signer,
      notarizer,
      logger: { ...SILENT_LOGGER, log }
    })

    expect(result).toEqual({ signed: false, notarized: false, reason: 'no-credentials' })
    expect(signer).not.toHaveBeenCalled()
    expect(notarizer).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
  })

  it('codesigns and notarizes on macOS when full credentials are present', async () => {
    const signer = vi.fn(() => ({ success: true }))
    const notarizer = vi.fn(async () => ({ ticketId: 'abc' }))

    const result = await signAndNotarizeMacArtifact({
      binaryPath: BIN,
      platform: 'darwin-x64',
      env: { ...macCreds },
      signer,
      notarizer,
      logger: SILENT_LOGGER
    })

    expect(result.signed).toBe(true)
    expect(result.notarized).toBe(true)
    expect(result.signingIdentity).toBe(macCreds.APPLE_SIGNING_IDENTITY)
    expect(result.teamId).toBe(macCreds.APPLE_TEAM_ID)
    expect(result.notarization).toEqual({ notarized: true, ticketId: 'abc' })

    expect(signer).toHaveBeenCalledWith({
      binaryPath: BIN,
      identity: macCreds.APPLE_SIGNING_IDENTITY,
      teamId: macCreds.APPLE_TEAM_ID
    })
    expect(notarizer).toHaveBeenCalledWith({
      binaryPath: BIN,
      appleId: macCreds.APPLE_ID,
      appleIdPassword: macCreds.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: macCreds.APPLE_TEAM_ID
    })
  })

  it('signs but skips notarization when notarization credentials are absent', async () => {
    const signer = vi.fn(() => ({ success: true }))
    const notarizer = vi.fn(async () => ({ ticketId: 'abc' }))

    const result = await signAndNotarizeMacArtifact({
      binaryPath: BIN,
      platform: 'darwin-arm64',
      env: {
        APPLE_SIGNING_IDENTITY: macCreds.APPLE_SIGNING_IDENTITY,
        APPLE_TEAM_ID: macCreds.APPLE_TEAM_ID
        // APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD intentionally absent
      },
      signer,
      notarizer,
      logger: SILENT_LOGGER
    })

    expect(result.signed).toBe(true)
    expect(result.notarized).toBe(false)
    expect(result.signingIdentity).toBe(macCreds.APPLE_SIGNING_IDENTITY)
    expect(result.teamId).toBe(macCreds.APPLE_TEAM_ID)
    expect(signer).toHaveBeenCalledTimes(1)
    expect(notarizer).not.toHaveBeenCalled()
  })

  it('reports unsigned when the injected signer fails', async () => {
    const signer = vi.fn(() => ({ success: false }))
    const notarizer = vi.fn(async () => ({ ticketId: 'abc' }))

    const result = await signAndNotarizeMacArtifact({
      binaryPath: BIN,
      platform: 'darwin-arm64',
      env: { ...macCreds },
      signer,
      notarizer,
      logger: SILENT_LOGGER
    })

    expect(result.signed).toBe(false)
    expect(result.notarized).toBe(false)
    expect(notarizer).not.toHaveBeenCalled()
  })
})

describe('applySigningMetadataToEntry', () => {
  const baseEntry = {
    platform: 'darwin-arm64',
    binaryName: 'codex',
    size: 1234,
    sha256: 'a'.repeat(64)
  }

  it('returns a new entry enriched with signing + notarization metadata without mutating input', () => {
    const signResult = {
      signed: true,
      notarized: true,
      signingIdentity: macCreds.APPLE_SIGNING_IDENTITY,
      teamId: macCreds.APPLE_TEAM_ID,
      notarization: { notarized: true, ticketId: 'abc' }
    }

    const enriched = applySigningMetadataToEntry(baseEntry, signResult)

    expect(enriched).not.toBe(baseEntry)
    expect(baseEntry).toEqual({
      platform: 'darwin-arm64',
      binaryName: 'codex',
      size: 1234,
      sha256: 'a'.repeat(64)
    })
    expect(enriched.signingIdentity).toBe(macCreds.APPLE_SIGNING_IDENTITY)
    expect(enriched.teamId).toBe(macCreds.APPLE_TEAM_ID)
    expect(enriched.notarization).toEqual({ notarized: true, ticketId: 'abc' })

    // The enriched entry must validate against the Task-3 manifest schema.
    expect(() => validateManifestEntry(enriched)).not.toThrow()
  })

  it('sets signing fields but no notarization when signed only', () => {
    const signResult = {
      signed: true,
      notarized: false,
      signingIdentity: macCreds.APPLE_SIGNING_IDENTITY,
      teamId: macCreds.APPLE_TEAM_ID
    }

    const enriched = applySigningMetadataToEntry(baseEntry, signResult)

    expect(enriched.signingIdentity).toBe(macCreds.APPLE_SIGNING_IDENTITY)
    expect(enriched.teamId).toBe(macCreds.APPLE_TEAM_ID)
    expect(enriched.notarization).toBeUndefined()
    expect(() => validateManifestEntry(enriched)).not.toThrow()
  })

  it('returns the entry unchanged for a no-op sign result and fabricates no fields', () => {
    const signResult = { signed: false, notarized: false, reason: 'no-credentials' }

    const enriched = applySigningMetadataToEntry(baseEntry, signResult)

    expect(enriched).toEqual(baseEntry)
    expect(enriched.signingIdentity).toBeUndefined()
    expect(enriched.teamId).toBeUndefined()
    expect(enriched.notarization).toBeUndefined()
    expect(() => validateManifestEntry(enriched)).not.toThrow()
  })
})
