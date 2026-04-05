const fs = require('fs')
const path = require('path')
const Module = require('module')
const asar = require('@electron/asar')

const projectRoot = path.resolve(__dirname, '..')
const builtinModules = new Set(
  Module.builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`]).concat(['electron', 'original-fs'])
)
const PACKAGE_NAME_PATTERN = /^(?:@[\w.-]+\/)?[\w.-]+$/
const PACKAGED_RUNTIME_NODE_MODULES_DIR = 'node_modules'

const normalizePackageName = (specifier) => {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:')) {
    return null
  }

  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    const packageName = scope && name ? `${scope}/${name}` : null
    return packageName && PACKAGE_NAME_PATTERN.test(packageName) ? packageName : null
  }

  const packageName = specifier.split('/')[0]
  return PACKAGE_NAME_PATTERN.test(packageName) ? packageName : null
}

const extractBareSpecifiers = (source) => {
  const specifiers = new Set()
  const patterns = [
    /require\((['"`])([^'"`]+)\1\)/g,
    /import\((['"`])([^'"`]+)\1\)/g,
    /\b(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?(['"`])([^'"`]+)\1/g
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const packageName = normalizePackageName(match[2])
      if (packageName && !builtinModules.has(packageName)) {
        specifiers.add(packageName)
      }
    }
  }

  return [...specifiers]
}

const extractSpecifiers = (source) => {
  const specifiers = new Set()
  const patterns = [
    /require\((['"`])([^'"`]+)\1\)/g,
    /import\((['"`])([^'"`]+)\1\)/g,
    /\b(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?(['"`])([^'"`]+)\1/g
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[2]) {
        specifiers.add(match[2])
      }
    }
  }

  return [...specifiers]
}

const readStartupRoots = () => {
  const entryFiles = [path.join(projectRoot, 'out/main/index.js'), path.join(projectRoot, 'out/proxy/index.js')]

  const roots = new Set()

  for (const file of entryFiles) {
    if (!fs.existsSync(file)) {
      continue
    }

    const source = fs.readFileSync(file, 'utf8')
    for (const packageName of extractBareSpecifiers(source)) {
      roots.add(packageName)
    }
  }

  return [...roots].sort()
}

const resolveManifestFromResolvedPath = (resolvedPath) => {
  let currentDir = path.dirname(resolvedPath)
  const rootDir = path.parse(currentDir).root

  while (currentDir !== rootDir) {
    const manifestPath = path.join(currentDir, 'package.json')
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      if (manifest.name) {
        return { manifest, manifestPath }
      }
    }
    currentDir = path.dirname(currentDir)
  }

  throw new Error(`Unable to locate package.json from ${resolvedPath}`)
}

const resolvePackageRoot = (packageName, basedir) =>
  path.dirname(resolveManifestFromResolvedPath(require.resolve(packageName, { paths: [basedir] })).manifestPath)

const getOwningPackageName = (filePath) => {
  if (!filePath.includes(`${path.sep}node_modules${path.sep}`)) {
    return '<startup>'
  }

  try {
    return resolveManifestFromResolvedPath(filePath).manifest.name
  } catch (_error) {
    return extractPackageNameFromNodeModulesPath(filePath.split(path.sep).join('/')) || '<startup>'
  }
}

const collectDependencyClosure = () => {
  const startupEntryFiles = [
    path.join(projectRoot, 'out/main/index.js'),
    path.join(projectRoot, 'out/proxy/index.js')
  ].filter((file) => fs.existsSync(file))
  const queue = [...startupEntryFiles]
  const visitedFiles = new Set()
  const visitedPackageRoots = new Set()
  const visited = new Set()
  const parents = new Map()
  const skippedPackages = new Set()

  while (queue.length > 0) {
    const currentFile = queue.shift()
    if (!currentFile || visitedFiles.has(currentFile) || currentFile.endsWith('.node')) {
      continue
    }

    visitedFiles.add(currentFile)

    let source
    try {
      source = fs.readFileSync(currentFile, 'utf8')
    } catch (_error) {
      continue
    }

    const localRequire = Module.createRequire(currentFile)

    for (const specifier of extractSpecifiers(source)) {
      const packageSpecifier = normalizePackageName(specifier)

      if (packageSpecifier && !builtinModules.has(packageSpecifier)) {
        let resolvedPath
        try {
          resolvedPath = localRequire.resolve(specifier, { paths: [path.dirname(currentFile)] })
        } catch (_error) {
          skippedPackages.add(packageSpecifier)
          continue
        }

        let resolvedManifest
        try {
          resolvedManifest = resolveManifestFromResolvedPath(resolvedPath)
        } catch (_error) {
          skippedPackages.add(packageSpecifier)
          continue
        }

        const packageName = resolvedManifest.manifest.name || packageSpecifier
        const packageRoot = path.dirname(resolvedManifest.manifestPath)
        const parentPackage = getOwningPackageName(currentFile)

        visited.add(packageName)
        if (!parents.has(packageName)) {
          parents.set(packageName, parentPackage)
        }

        if (!visitedPackageRoots.has(packageRoot)) {
          visitedPackageRoots.add(packageRoot)
          queue.push(resolvedPath)
        }
        continue
      }

      if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
        continue
      }

      try {
        const resolvedPath = localRequire.resolve(specifier, { paths: [path.dirname(currentFile)] })
        queue.push(resolvedPath)
      } catch (_error) {
        continue
      }
    }
  }

  return { packageNames: visited, parents, skippedPackages }
}

const extractPackageNameFromNodeModulesPath = (entryPath) => {
  const parts = entryPath.split('/').filter(Boolean)
  let packageName = null

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== 'node_modules') {
      continue
    }

    const next = parts[i + 1]
    if (!next) {
      continue
    }

    if (next.startsWith('@')) {
      const scopedName = parts[i + 2]
      if (scopedName) {
        packageName = `${next}/${scopedName}`
      }
      i += 2
      continue
    }

    packageName = next
    i += 1
  }

  return packageName
}

const collectPackagedPackageNames = (appOutDir) => {
  const packagedNames = new Set()
  const resourcesDir = resolveResourcesDir(appOutDir)
  const archivePath = path.join(resourcesDir, 'app.asar')
  const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked')
  const fallbackNodeModulesDir = path.join(resourcesDir, PACKAGED_RUNTIME_NODE_MODULES_DIR)

  if (fs.existsSync(archivePath)) {
    for (const entry of asar.listPackage(archivePath)) {
      if (!entry.endsWith('/package.json') || !entry.includes('/node_modules/')) {
        continue
      }
      const packageName = extractPackageNameFromNodeModulesPath(entry)
      if (packageName) {
        packagedNames.add(packageName)
      }
    }
  }

  if (fs.existsSync(unpackedDir)) {
    const stack = [unpackedDir]
    while (stack.length > 0) {
      const currentDir = stack.pop()
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          stack.push(fullPath)
          continue
        }
        if (
          entry.isFile() &&
          entry.name === 'package.json' &&
          fullPath.includes(`${path.sep}node_modules${path.sep}`)
        ) {
          const relativePath = fullPath.slice(unpackedDir.length).split(path.sep).join('/')
          const packageName = extractPackageNameFromNodeModulesPath(relativePath)
          if (packageName) {
            packagedNames.add(packageName)
          }
        }
      }
    }
  }

  if (fs.existsSync(fallbackNodeModulesDir)) {
    const stack = [fallbackNodeModulesDir]
    while (stack.length > 0) {
      const currentDir = stack.pop()
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          stack.push(fullPath)
          continue
        }
        if (
          entry.isFile() &&
          entry.name === 'package.json' &&
          fullPath.includes(`${path.sep}node_modules${path.sep}`)
        ) {
          const relativePath = fullPath.slice(resourcesDir.length).split(path.sep).join('/')
          const packageName = extractPackageNameFromNodeModulesPath(relativePath)
          if (packageName) {
            packagedNames.add(packageName)
          }
        }
      }
    }
  }

  return packagedNames
}

const formatMissingDependency = (packageName, parents) => {
  const chain = [packageName]
  let current = parents.get(packageName)

  while (current && current !== '<startup>') {
    chain.unshift(current)
    current = parents.get(current)
  }

  return current === '<startup>' ? `<startup> -> ${chain.join(' -> ')}` : chain.join(' -> ')
}

const resolveResourcesDir = (appOutDir) => {
  const directResourcesDir = path.join(appOutDir, 'Contents/Resources')
  if (fs.existsSync(directResourcesDir)) {
    return directResourcesDir
  }

  if (!fs.existsSync(appOutDir) || !fs.statSync(appOutDir).isDirectory()) {
    throw new Error(`Unable to locate packaged app output at ${appOutDir}`)
  }

  const appBundle = fs
    .readdirSync(appOutDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.endsWith('.app'))

  if (!appBundle) {
    throw new Error(`Unable to locate macOS app bundle inside ${appOutDir}`)
  }

  const bundledResourcesDir = path.join(appOutDir, appBundle.name, 'Contents/Resources')
  if (!fs.existsSync(bundledResourcesDir)) {
    throw new Error(`Unable to locate Resources directory inside ${path.join(appOutDir, appBundle.name)}`)
  }

  return bundledResourcesDir
}

const analyzePackagedRuntimeDependencies = (appOutDir) => {
  const startupRoots = readStartupRoots()
  if (startupRoots.length === 0) {
    throw new Error('No startup entry dependencies were found in out/main/index.js or out/proxy/index.js')
  }

  const { packageNames: expectedPackages, parents, skippedPackages } = collectDependencyClosure()
  const packagedPackages = collectPackagedPackageNames(appOutDir)
  const missingPackages = [...expectedPackages]
    .filter((packageName) => !packagedPackages.has(packageName))
    .sort((left, right) => left.localeCompare(right))
    .map((packageName) => {
      try {
        return {
          availableLocally: true,
          chain: formatMissingDependency(packageName, parents),
          name: packageName,
          sourceDir: resolvePackageRoot(packageName, projectRoot)
        }
      } catch (_error) {
        return {
          availableLocally: false,
          chain: formatMissingDependency(packageName, parents),
          name: packageName,
          sourceDir: null
        }
      }
    })

  return {
    expectedPackages,
    missingPackages,
    packagedPackages,
    skippedPackages,
    startupRoots
  }
}

const copyMissingStartupRuntimeDependencies = (appOutDir) => {
  const analysis = analyzePackagedRuntimeDependencies(appOutDir)
  const resourcesDir = resolveResourcesDir(appOutDir)
  const fallbackNodeModulesDir = path.join(resourcesDir, PACKAGED_RUNTIME_NODE_MODULES_DIR)
  const copiedPackages = []

  for (const missingPackage of analysis.missingPackages) {
    if (!missingPackage.availableLocally || !missingPackage.sourceDir) {
      continue
    }

    const destinationDir = path.join(fallbackNodeModulesDir, missingPackage.name)
    fs.mkdirSync(path.dirname(destinationDir), { recursive: true })
    fs.rmSync(destinationDir, { force: true, recursive: true })
    fs.cpSync(missingPackage.sourceDir, destinationDir, { recursive: true })
    copiedPackages.push(missingPackage.name)
  }

  return {
    ...analysis,
    copiedPackages
  }
}

const verifyPackagedRuntimeDependencies = (appOutDir) => {
  const analysis = analyzePackagedRuntimeDependencies(appOutDir)
  const actionableMissingPackages = analysis.missingPackages.filter((pkg) => pkg.availableLocally)
  const unavailableMissingPackages = analysis.missingPackages.filter((pkg) => !pkg.availableLocally)

  if (actionableMissingPackages.length > 0) {
    const details = actionableMissingPackages.map((pkg) => `- ${pkg.chain}`).join('\n')
    throw new Error(
      `Packaged app is missing runtime dependencies required during startup.\n` +
        `Startup roots: ${analysis.startupRoots.join(', ')}\n` +
        `Missing packages available in local node_modules:\n${details}\n`
    )
  }

  if (analysis.skippedPackages.size > 0) {
    process.stdout.write(
      `[verify-packaged-runtime-deps] Skipped unresolved startup references: ${[...analysis.skippedPackages].sort().join(', ')}\n`
    )
  }

  if (unavailableMissingPackages.length > 0) {
    const details = unavailableMissingPackages.map((pkg) => pkg.chain).join(', ')
    process.stdout.write(
      `[verify-packaged-runtime-deps] Ignoring unavailable startup references on this machine: ${details}\n`
    )
  }

  process.stdout.write(
    `[verify-packaged-runtime-deps] Verified ${analysis.expectedPackages.size} startup runtime packages in ${appOutDir}\n`
  )
}

if (require.main === module) {
  const appOutDir = process.argv[2]
  if (!appOutDir) {
    throw new Error('Usage: node scripts/verify-packaged-runtime-deps.js <appOutDir>')
  }

  verifyPackagedRuntimeDependencies(path.resolve(appOutDir))
}

module.exports = {
  analyzePackagedRuntimeDependencies,
  copyMissingStartupRuntimeDependencies,
  verifyPackagedRuntimeDependencies
}
