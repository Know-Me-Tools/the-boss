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
 * Maps every name a runtime can appear under — both the manifest DISPLAY NAME
 * emitted by scripts/build-runtime-artifacts.js (e.g. 'universal-agent-runtime')
 * and the canonical matrix KEY (e.g. 'uar') — to the canonical matrix key.
 *
 * This closes the gap where the matrix is keyed by 'uar' but the build pipeline
 * emits manifests named 'universal-agent-runtime': callers that only check
 * RUNTIME_KEYS.includes(name) would silently skip matrix validation for the
 * primary runtime. Resolve through resolveRuntimeKey() instead.
 *
 * Reused by later release tooling (gates, signing) so the name↔key mapping lives
 * in exactly one place.
 */
const RUNTIME_NAME_TO_KEY = Object.freeze({
  'universal-agent-runtime': 'uar',
  uar: 'uar',
  opencode: 'opencode',
  codex: 'codex'
})

/**
 * Resolves a manifest name OR a matrix key to the canonical matrix key.
 *
 * Accepts either the display name emitted by the build pipeline
 * ('universal-agent-runtime') or the matrix key ('uar'/'opencode'/'codex').
 * Returns the canonical key when recognized, or `undefined` for an unrecognized
 * name so callers can decide how to handle non-matrix runtimes.
 *
 * @param {string} nameOrKey
 * @returns {string | undefined}
 */
const resolveRuntimeKey = (nameOrKey) => {
  if (typeof nameOrKey !== 'string') {
    return undefined
  }
  return Object.prototype.hasOwnProperty.call(RUNTIME_NAME_TO_KEY, nameOrKey)
    ? RUNTIME_NAME_TO_KEY[nameOrKey]
    : undefined
}

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

/**
 * Resolves a runtime name/key to a canonical matrix key, throwing for unknown
 * inputs. Accepts both display names ('universal-agent-runtime') and matrix keys
 * ('uar') so all matrix lookups work regardless of which form the caller holds.
 *
 * @param {string} runtime
 * @returns {string}
 */
const requireRuntimeKey = (runtime) => {
  const key = resolveRuntimeKey(runtime)
  if (key === undefined) {
    throw new Error(`Unknown runtime key: ${String(runtime)}. Expected one of: ${RUNTIME_KEYS.join(', ')}`)
  }
  return key
}

/**
 * Returns the supported platform triples for a managed runtime.
 * Accepts a display name or matrix key. Throws for an unknown runtime.
 *
 * @param {string} runtime
 * @returns {readonly string[]}
 */
const getSupportedPlatforms = (runtime) => {
  const key = requireRuntimeKey(runtime)
  return MANAGED_RUNTIME_PLATFORM_MATRIX[key]
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
  RUNTIME_NAME_TO_KEY,
  resolveRuntimeKey,
  getSupportedPlatforms,
  isPlatformSupported,
  requiredPlatformsFor
}
