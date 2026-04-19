import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const { artifactRuntimeRootPackages } = require('../artifact-runtime-packages')
const {
  auditStartupBundleExternalReferences,
  collectPackageDependencyClosure,
  computeFallbackPackageNames,
  findForbiddenPackagedBuildArtifacts,
  shouldCopyFallbackRuntimePath
} = require('../verify-packaged-runtime-deps')
const { runtimeExternalPackages, validateRuntimeExternalPackages } = require('../runtime-external-packages')

const tempDirs: string[] = []

const createTempDir = () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-packaged-runtime-deps-'))
  tempDirs.push(tempDir)
  return tempDir
}

const writePackage = (
  rootDir: string,
  packageName: string,
  dependencies: Record<string, string> = {},
  options: {
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
  } = {}
) => {
  const packageDir = path.join(rootDir, 'node_modules', ...packageName.split('/'))
  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({
      dependencies,
      main: 'index.js',
      name: packageName,
      peerDependencies: options.peerDependencies,
      peerDependenciesMeta: options.peerDependenciesMeta,
      version: '1.0.0'
    })
  )
  fs.writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = {};\n')
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop()
    if (tempDir) {
      fs.rmSync(tempDir, { force: true, recursive: true })
    }
  }
})

describe('verify-packaged-runtime-deps', () => {
  it('validates the runtime external manifest', () => {
    expect(() => validateRuntimeExternalPackages(runtimeExternalPackages)).not.toThrow()
    expect(new Set(runtimeExternalPackages).size).toBe(runtimeExternalPackages.length)
    expect(runtimeExternalPackages).toContain('esbuild')
    expect(runtimeExternalPackages).toEqual(
      expect.arrayContaining(['@anush008/tokenizers', '@mastra/fastembed', 'fastembed', 'onnxruntime-node'])
    )
  })

  it('defines the dedicated React artifact runtime roots', () => {
    expect(artifactRuntimeRootPackages).toEqual([
      'clsx',
      'lucide-react',
      'react',
      'react-dom',
      'scheduler',
      'tailwind-merge'
    ])
  })

  it('collects the full dependency closure for declared runtime externals', () => {
    const tempDir = createTempDir()

    writePackage(tempDir, 'selection-hook', { debug: '^1.0.0' })
    writePackage(tempDir, 'debug', { ms: '^1.0.0' })
    writePackage(tempDir, 'ms')

    const closure = collectPackageDependencyClosure(['selection-hook'], tempDir)

    expect([...closure.packageNames].sort()).toEqual(['debug', 'ms', 'selection-hook'])
    expect(closure.parents.get('debug')).toBe('selection-hook')
    expect(closure.parents.get('ms')).toBe('debug')
  })

  it('collects the dependency closure for dedicated artifact runtime packages', () => {
    const tempDir = createTempDir()

    writePackage(tempDir, 'react', {})
    writePackage(tempDir, 'react-dom', { react: '^19.0.0', scheduler: '^1.0.0' })
    writePackage(tempDir, 'scheduler')
    writePackage(tempDir, 'clsx')
    writePackage(tempDir, 'lucide-react', { react: '^19.0.0' })
    writePackage(tempDir, 'tailwind-merge')

    const closure = collectPackageDependencyClosure(artifactRuntimeRootPackages, tempDir)

    expect([...closure.packageNames].sort()).toEqual([
      'clsx',
      'lucide-react',
      'react',
      'react-dom',
      'scheduler',
      'tailwind-merge'
    ])
    expect(closure.parents.get('scheduler')).toBe('react-dom')
  })

  it('collects required peer dependencies in the package closure', () => {
    const tempDir = createTempDir()

    writePackage(tempDir, 'openai-oauth', { ai: '^1.0.0' })
    writePackage(tempDir, 'ai', {}, { peerDependencies: { zod: '^4.0.0' } })
    writePackage(tempDir, 'zod')

    const closure = collectPackageDependencyClosure(['openai-oauth'], tempDir)

    expect([...closure.packageNames].sort()).toEqual(['ai', 'openai-oauth', 'zod'])
    expect(closure.parents.get('zod')).toBe('ai')
  })

  it('copies only declared external packages that are missing from the primary package', () => {
    const fallbackPackageNames = computeFallbackPackageNames({
      externalExpectedPackages: new Set(),
      expectedPackages: new Set(['selection-hook', 'debug', 'ms']),
      primaryPackagedPackageNames: new Set(['selection-hook'])
    })

    expect([...fallbackPackageNames].sort()).toEqual(['debug', 'ms'])
  })

  it('requires declared external runtime dependencies in fallback node_modules even if bundled elsewhere', () => {
    const fallbackPackageNames = computeFallbackPackageNames({
      externalExpectedPackages: new Set(['openai-oauth', 'yargs']),
      expectedPackages: new Set(['openai-oauth', 'yargs']),
      primaryPackagedPackageNames: new Set(['yargs'])
    })

    expect([...fallbackPackageNames].sort()).toEqual(['openai-oauth', 'yargs'])
  })

  it('skips nested pnpm bin shims when copying fallback runtime packages', () => {
    expect(shouldCopyFallbackRuntimePath('/tmp/pkg/node_modules/.bin/semver')).toBe(false)
    expect(shouldCopyFallbackRuntimePath('/tmp/pkg/node_modules/semver/bin/semver.js')).toBe(true)
  })

  it('flags build-only artifacts that must never enter packaged app contents', () => {
    const findings = findForbiddenPackagedBuildArtifacts([
      '/vendor/universal-agent-runtime/target/release/universal-agent-runtime',
      '/.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json',
      '/.refiner/artifacts/change-001/refinement_log.md',
      '/dist/The-Boss-1.9.1-arm64.dmg',
      '/resources/binaries/darwin-arm64/universal-agent-runtime',
      '/node_modules/react/package.json'
    ])

    expect(findings).toEqual([
      {
        label: 'vendored source checkout',
        path: 'vendor/universal-agent-runtime/target/release/universal-agent-runtime'
      },
      {
        label: 'KBD orchestration state',
        path: '.kbd-orchestrator/phases/multi-runtime-agent-parity-assessment/progress.json'
      },
      {
        label: 'artifact-refiner state',
        path: '.refiner/artifacts/change-001/refinement_log.md'
      },
      {
        label: 'nested release output',
        path: 'dist/The-Boss-1.9.1-arm64.dmg'
      }
    ])
  })

  it('flags undeclared startup externals referenced by the built bundle', () => {
    const tempDir = createTempDir()
    const entryFile = path.join(tempDir, 'out/main/index.js')

    writePackage(tempDir, 'debug')
    fs.mkdirSync(path.dirname(entryFile), { recursive: true })
    fs.writeFileSync(entryFile, "require('debug')\n")

    const audit = auditStartupBundleExternalReferences({
      declaredExternalPackages: [],
      entryFiles: [entryFile]
    })

    expect(audit.startupRoots).toEqual(['debug'])
    expect(audit.undeclaredPackageNames).toEqual(['debug'])
  })

  it('flags missing relative createRequire targets emitted into the startup bundle', () => {
    const tempDir = createTempDir()
    const entryFile = path.join(tempDir, 'out/main/index.js')

    fs.mkdirSync(path.dirname(entryFile), { recursive: true })
    fs.writeFileSync(
      entryFile,
      "const fonts = module.createRequire(__filename)('./libs/core')\nmodule.exports = fonts\n"
    )

    const audit = auditStartupBundleExternalReferences({
      declaredExternalPackages: [],
      entryFiles: [entryFile]
    })

    expect(audit.missingBundledRelativeSpecifiers).toEqual([
      {
        entryFile,
        specifier: './libs/core'
      }
    ])
  })

  it('detects aliased createRequire.resolve startup package references', () => {
    const tempDir = createTempDir()
    const entryFile = path.join(tempDir, 'out/main/index.js')

    writePackage(tempDir, 'openai-oauth')
    fs.mkdirSync(path.dirname(entryFile), { recursive: true })
    fs.writeFileSync(
      entryFile,
      "const runtimeRequire = module.createRequire(__filename)\nruntimeRequire.resolve('openai-oauth')\n"
    )

    const audit = auditStartupBundleExternalReferences({
      declaredExternalPackages: [],
      entryFiles: [entryFile]
    })

    expect(audit.startupRoots).toEqual(['openai-oauth'])
    expect(audit.undeclaredPackageNames).toEqual(['openai-oauth'])
  })
})
