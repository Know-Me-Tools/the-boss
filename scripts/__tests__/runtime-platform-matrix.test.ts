import { describe, expect, it } from 'vitest'

const {
  ALL_PLATFORMS,
  MANAGED_RUNTIME_PLATFORM_MATRIX,
  RUNTIME_KEYS,
  resolveRuntimeKey,
  getSupportedPlatforms,
  isPlatformSupported,
  requiredPlatformsFor
} = require('../runtime-platform-matrix')

const EXPECTED_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']

describe('runtime-platform-matrix', () => {
  describe('ALL_PLATFORMS', () => {
    it('contains exactly the six expected platform-arch triples', () => {
      expect([...ALL_PLATFORMS].sort()).toEqual([...EXPECTED_PLATFORMS].sort())
      expect(ALL_PLATFORMS).toHaveLength(6)
    })

    it('is frozen and cannot be mutated', () => {
      expect(Object.isFrozen(ALL_PLATFORMS)).toBe(true)
      expect(() => {
        ;(ALL_PLATFORMS as string[]).push('bogus-arch')
      }).toThrow()
      expect(ALL_PLATFORMS).toHaveLength(6)
    })
  })

  describe('RUNTIME_KEYS', () => {
    it('lists uar, opencode, and codex', () => {
      expect([...RUNTIME_KEYS].sort()).toEqual(['codex', 'opencode', 'uar'])
    })

    it('is frozen', () => {
      expect(Object.isFrozen(RUNTIME_KEYS)).toBe(true)
    })
  })

  describe('MANAGED_RUNTIME_PLATFORM_MATRIX', () => {
    it('has uar, opencode, and codex keys', () => {
      expect(Object.keys(MANAGED_RUNTIME_PLATFORM_MATRIX).sort()).toEqual(['codex', 'opencode', 'uar'])
    })

    it('maps each runtime to a subset of ALL_PLATFORMS', () => {
      for (const runtime of RUNTIME_KEYS) {
        const platforms = MANAGED_RUNTIME_PLATFORM_MATRIX[runtime]
        expect(Array.isArray(platforms)).toBe(true)
        for (const platform of platforms) {
          expect(ALL_PLATFORMS).toContain(platform)
        }
      }
    })

    it('gives each runtime its own array (not a shared reference)', () => {
      expect(MANAGED_RUNTIME_PLATFORM_MATRIX.uar).not.toBe(MANAGED_RUNTIME_PLATFORM_MATRIX.opencode)
      expect(MANAGED_RUNTIME_PLATFORM_MATRIX.opencode).not.toBe(MANAGED_RUNTIME_PLATFORM_MATRIX.codex)
      expect(MANAGED_RUNTIME_PLATFORM_MATRIX.uar).not.toBe(MANAGED_RUNTIME_PLATFORM_MATRIX.codex)
    })

    it('is frozen and cannot be mutated', () => {
      expect(Object.isFrozen(MANAGED_RUNTIME_PLATFORM_MATRIX)).toBe(true)
      const before = MANAGED_RUNTIME_PLATFORM_MATRIX.uar
      expect(() => {
        ;(MANAGED_RUNTIME_PLATFORM_MATRIX as Record<string, unknown>).uar = []
      }).toThrow()
      expect(MANAGED_RUNTIME_PLATFORM_MATRIX.uar).toBe(before)
    })
  })

  describe('resolveRuntimeKey', () => {
    it('maps the UAR display name to the matrix key', () => {
      expect(resolveRuntimeKey('universal-agent-runtime')).toBe('uar')
    })

    it('maps the matrix key to itself', () => {
      expect(resolveRuntimeKey('uar')).toBe('uar')
      expect(resolveRuntimeKey('opencode')).toBe('opencode')
      expect(resolveRuntimeKey('codex')).toBe('codex')
    })

    it('returns undefined for an unrecognized name', () => {
      expect(resolveRuntimeKey('nope')).toBeUndefined()
    })

    it('returns undefined for a non-string input', () => {
      expect(resolveRuntimeKey(undefined as unknown as string)).toBeUndefined()
    })
  })

  describe('getSupportedPlatforms', () => {
    it('returns the supported list for a known runtime', () => {
      expect([...getSupportedPlatforms('uar')].sort()).toEqual([...MANAGED_RUNTIME_PLATFORM_MATRIX.uar].sort())
    })

    it('resolves a display name to the matrix key', () => {
      expect([...getSupportedPlatforms('universal-agent-runtime')].sort()).toEqual(
        [...MANAGED_RUNTIME_PLATFORM_MATRIX.uar].sort()
      )
    })

    it('throws a clear error for an unknown runtime key', () => {
      expect(() => getSupportedPlatforms('bogus')).toThrow(/unknown runtime/i)
    })
  })

  describe('isPlatformSupported', () => {
    it('returns true for a supported runtime/platform pair', () => {
      expect(isPlatformSupported('codex', 'win32-arm64')).toBe(true)
    })

    it('resolves a display name when checking platform support', () => {
      expect(isPlatformSupported('universal-agent-runtime', 'darwin-arm64')).toBe(true)
      expect(isPlatformSupported('universal-agent-runtime', 'darwin-mips')).toBe(false)
    })

    it('returns false for an unsupported platform', () => {
      expect(isPlatformSupported('uar', 'bogus-arch')).toBe(false)
    })

    it('throws for an unknown runtime key', () => {
      expect(() => isPlatformSupported('bogus', 'darwin-arm64')).toThrow(/unknown runtime/i)
    })
  })

  describe('requiredPlatformsFor', () => {
    it('equals the supported list for a runtime', () => {
      expect(requiredPlatformsFor('opencode')).toEqual(getSupportedPlatforms('opencode'))
    })

    it('throws for an unknown runtime key', () => {
      expect(() => requiredPlatformsFor('bogus')).toThrow(/unknown runtime/i)
    })
  })
})
