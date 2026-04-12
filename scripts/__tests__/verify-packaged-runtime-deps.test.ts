import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const { artifactRuntimeRootPackages } = require('../artifact-runtime-packages')
const {
  auditStartupBundleExternalReferences,
  collectPackageDependencyClosure,
  computeFallbackPackageNames
} = require('../verify-packaged-runtime-deps')
const { runtimeExternalPackages, validateRuntimeExternalPackages } = require('../runtime-external-packages')

const tempDirs: string[] = []

const createTempDir = () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-packaged-runtime-deps-'))
  tempDirs.push(tempDir)
  return tempDir
}

const writePackage = (rootDir: string, packageName: string, dependencies: Record<string, string> = {}) => {
  const packageDir = path.join(rootDir, 'node_modules', ...packageName.split('/'))
  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({
      dependencies,
      main: 'index.js',
      name: packageName,
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

  it('copies only declared external packages that are missing from the primary package', () => {
    const fallbackPackageNames = computeFallbackPackageNames({
      expectedPackages: new Set(['selection-hook', 'debug', 'ms']),
      primaryPackagedPackageNames: new Set(['selection-hook'])
    })

    expect([...fallbackPackageNames].sort()).toEqual(['debug', 'ms'])
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
})
