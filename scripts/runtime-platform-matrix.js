/**
 * Authoritative platform matrix for the three managed runtimes.
 *
 * This file is the SINGLE source of truth for which platform-arch triples each
 * managed runtime (UAR, OpenCode, Codex) supports. Build scripts, release
 * tooling, and verification checks should import from here rather than
 * re-declaring platform lists.
 *
 * How to encode an exception:
 *   Each runtime in MANAGED_RUNTIME_PLATFORM_MATRIX owns its OWN explicit array
 *   (not a shared reference). To drop a platform from a single runtime, remove
 *   that one triple from that runtime's array — a one-line edit that does not
 *   affect the other runtimes. Add a comment explaining why the platform is
 *   excluded.
 */

// The six platform-arch triples used across the repository.
const ALL_PLATFORMS = Object.freeze([
  'darwin-arm64',
  'darwin-x64',
  'linux-x64',
  'linux-arm64',
  'win32-x64',
  'win32-arm64'
])

// Managed runtime keys, in canonical order.
const RUNTIME_KEYS = Object.freeze(['uar', 'opencode', 'codex'])

/**
 * Per-runtime supported platforms.
 *
 * Each runtime has its own explicit array so per-runtime exceptions are a
 * one-line edit (see "How to encode an exception" above).
 *
 * Current state (from codebase survey):
 *  - uar:      Rust runtime, cargo cross-compiles to all six targets.
 *  - opencode: scripts/build-opencode-runtime.js handles all six.
 *  - codex:    @openai/codex-* packages exist for all six (see
 *              scripts/runtime-external-packages.js).
 */
const MANAGED_RUNTIME_PLATFORM_MATRIX = Object.freeze({
  uar: Object.freeze(['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']),
  opencode: Object.freeze(['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']),
  codex: Object.freeze(['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64'])
})

const assertKnownRuntime = (runtime) => {
  if (!Object.prototype.hasOwnProperty.call(MANAGED_RUNTIME_PLATFORM_MATRIX, runtime)) {
    throw new Error(`Unknown runtime key: ${String(runtime)}. Expected one of: ${RUNTIME_KEYS.join(', ')}`)
  }
}

/**
 * Returns the supported platform triples for a managed runtime.
 * Throws for an unknown runtime key.
 *
 * @param {string} runtime
 * @returns {readonly string[]}
 */
const getSupportedPlatforms = (runtime) => {
  assertKnownRuntime(runtime)
  return MANAGED_RUNTIME_PLATFORM_MATRIX[runtime]
}

/**
 * Returns whether a runtime supports a given platform triple.
 * Throws for an unknown runtime key.
 *
 * @param {string} runtime
 * @param {string} platform
 * @returns {boolean}
 */
const isPlatformSupported = (runtime, platform) => getSupportedPlatforms(runtime).includes(platform)

/**
 * Returns the platforms REQUIRED for a runtime release.
 *
 * For now required == supported. This is a separate function so a future
 * "supported but not required for release" distinction (e.g. a platform we can
 * build but do not gate a release on) can be encoded without changing callers.
 *
 * @param {string} runtime
 * @returns {readonly string[]}
 */
const requiredPlatformsFor = (runtime) => getSupportedPlatforms(runtime)

module.exports = {
  ALL_PLATFORMS,
  MANAGED_RUNTIME_PLATFORM_MATRIX,
  RUNTIME_KEYS,
  getSupportedPlatforms,
  isPlatformSupported,
  requiredPlatformsFor
}
