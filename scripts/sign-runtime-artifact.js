// Env-gated macOS code-sign + notarize for managed RUNTIME binaries
// (Universal Agent Runtime / OpenCode / Codex).
//
// This mirrors the gating philosophy of scripts/notarize.js: when the Apple
// signing credentials are absent (dev/local builds, non-release CI), this is a
// pure no-op so the normal `runtimes:build` is never broken. Real codesign /
// notarization only happen in release CI where the credentials are present.
//
// DEPENDENCY INJECTION SEAM
// -------------------------
// The expensive/side-effecting operations are injected:
//   - `signer({ binaryPath, identity, teamId }) -> { success: boolean }`
//   - `notarizer({ binaryPath, appleId, appleIdPassword, teamId }) -> Promise<{ ticketId?: string }>`
// The DEFAULT implementations shell out to `codesign` / `@electron/notarize`,
// but tests inject mocks so real codesign / notarytool NEVER run under Vitest.
//
// NOTARIZATION-OF-RAW-BINARY CAVEAT
// ---------------------------------
// Apple notarization submits an *archive* (zip/dmg/pkg), not a bare Mach-O
// binary. The DEFAULT notarizer below is therefore a thin, env-gated wrapper
// that documents this: a production CI path must wrap the signed binary in a
// zip before submitting to `notarize(...)`. The deliverable for this task is the
// SEAM + manifest metadata recording, not a fully working real notarization in
// this environment. Tests never invoke the default notarizer.
const { execFileSync } = require('node:child_process')

/**
 * Default codesign implementation. Shells out to `codesign` with hardened
 * runtime + secure timestamp. Tests inject a mock instead of calling this.
 *
 * @param {{ binaryPath: string, identity: string, teamId: string }} params
 * @returns {{ success: boolean }}
 */
function defaultSigner({ binaryPath, identity }) {
  execFileSync('codesign', ['--force', '--options', 'runtime', '--timestamp', '--sign', identity, binaryPath], {
    stdio: 'inherit'
  })
  return { success: true }
}

/**
 * Default notarizer. NOTE: Apple notarization requires submitting an archive,
 * not a bare binary, so a real CI path must zip `binaryPath` first. This default
 * is a thin wrapper around @electron/notarize's notarytool path and is never
 * exercised by tests. Returns the notarization ticket id when available.
 *
 * @param {{ binaryPath: string, appleId: string, appleIdPassword: string, teamId: string }} params
 * @returns {Promise<{ ticketId?: string }>}
 */
async function defaultNotarizer({ binaryPath, appleId, appleIdPassword, teamId }) {
  const { notarize } = require('@electron/notarize')
  // CI MUST pass a zipped archive path here; a bare Mach-O binary will be
  // rejected by Apple's notary service. See the file header caveat.
  await notarize({
    tool: 'notarytool',
    appPath: binaryPath,
    appleId,
    appleIdPassword,
    teamId
  })
  // notarytool does not surface a stable ticket id through @electron/notarize;
  // callers that need one should query the submission log themselves.
  return {}
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
function hasSigningCredentials(env) {
  return Boolean(env.APPLE_SIGNING_IDENTITY && env.APPLE_TEAM_ID)
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
function hasNotarizationCredentials(env) {
  return Boolean(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD)
}

/**
 * Code-sign and (optionally) notarize a macOS runtime binary. Env-gated: a
 * no-op when not a macOS target or when signing credentials are absent.
 *
 * @param {object} params
 * @param {string} params.binaryPath - Absolute path to the runtime binary.
 * @param {string} params.platform - Platform key, e.g. 'darwin-arm64'.
 * @param {Record<string, string | undefined>} [params.env] - Defaults to process.env.
 * @param {(p: { binaryPath: string, identity: string, teamId: string }) => { success: boolean }} [params.signer]
 * @param {(p: { binaryPath: string, appleId: string, appleIdPassword: string, teamId: string }) => Promise<{ ticketId?: string }>} [params.notarizer]
 * @param {{ log: Function, warn: Function, error: Function }} [params.logger]
 * @returns {Promise<{ signed: boolean, notarized: boolean, reason?: string, signingIdentity?: string, teamId?: string, notarization?: { notarized: boolean, ticketId?: string } }>}
 */
async function signAndNotarizeMacArtifact({
  binaryPath,
  platform,
  env = process.env,
  signer = defaultSigner,
  notarizer = defaultNotarizer,
  logger = console
} = {}) {
  if (!platform || !platform.startsWith('darwin-')) {
    return { signed: false, notarized: false, reason: 'not-macos' }
  }

  if (!hasSigningCredentials(env)) {
    logger.log(`  • Skipping macOS sign/notarize for ${binaryPath} (no Apple signing credentials)`)
    return { signed: false, notarized: false, reason: 'no-credentials' }
  }

  const identity = env.APPLE_SIGNING_IDENTITY
  const teamId = env.APPLE_TEAM_ID

  const signOutcome = signer({ binaryPath, identity, teamId })
  if (!signOutcome || signOutcome.success !== true) {
    logger.error(`  • codesign failed for ${binaryPath}`)
    return { signed: false, notarized: false, reason: 'codesign-failed' }
  }
  logger.log(`  • Codesigned ${binaryPath} with identity ${identity}`)

  if (!hasNotarizationCredentials(env)) {
    logger.log(`  • Skipping notarization for ${binaryPath} (no Apple notarization credentials)`)
    return { signed: true, notarized: false, signingIdentity: identity, teamId }
  }

  const notarizeOutcome = await notarizer({
    binaryPath,
    appleId: env.APPLE_ID,
    appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId
  })
  const ticketId = notarizeOutcome && notarizeOutcome.ticketId ? notarizeOutcome.ticketId : undefined
  const notarization = ticketId ? { notarized: true, ticketId } : { notarized: true }
  logger.log(`  • Notarized ${binaryPath}${ticketId ? ` (ticket ${ticketId})` : ''}`)

  return {
    signed: true,
    notarized: true,
    signingIdentity: identity,
    teamId,
    notarization
  }
}

/**
 * Enrich a manifest entry with signing/notarization metadata, immutably.
 * Returns a NEW entry. When the sign result is a no-op (unsigned), the entry is
 * returned unchanged and no fields are fabricated. The fields written match the
 * Task-3 manifest schema (signingIdentity, teamId, notarization).
 *
 * @template {object} TEntry
 * @param {TEntry} entry
 * @param {{ signed: boolean, notarized: boolean, signingIdentity?: string, teamId?: string, notarization?: { notarized: boolean, ticketId?: string } }} signResult
 * @returns {TEntry}
 */
function applySigningMetadataToEntry(entry, signResult) {
  if (!signResult || signResult.signed !== true) {
    return entry
  }

  const next = { ...entry }
  if (signResult.signingIdentity) {
    next.signingIdentity = signResult.signingIdentity
  }
  if (signResult.teamId) {
    next.teamId = signResult.teamId
  }
  if (signResult.notarized === true && signResult.notarization) {
    next.notarization = { ...signResult.notarization }
  }
  return next
}

module.exports = {
  signAndNotarizeMacArtifact,
  applySigningMetadataToEntry,
  defaultSigner,
  defaultNotarizer
}
