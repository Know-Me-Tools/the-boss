const fs = require('fs')
const path = require('path')
const Module = require('module')
const acorn = require('acorn')
const asar = require('@electron/asar')

const { getArtifactRuntimeRootPackageNames } = require('./artifact-runtime-packages')
const { getRuntimeExternalPackageNames, validateRuntimeExternalPackages } = require('./runtime-external-packages')

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

const extractSpecifiers = (source) => {
  const specifiers = new Set()

  try {
    const ast = acorn.parse(source, {
      allowHashBang: true,
      ecmaVersion: 'latest',
      sourceType: 'script'
    })

    const visitNode = (node) => {
      if (!node || typeof node !== 'object') {
        return
      }

      if (Array.isArray(node)) {
        for (const child of node) {
          visitNode(child)
        }
        return
      }

      if (typeof node.type === 'string') {
        if (
          node.type === 'CallExpression' &&
          node.callee?.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments?.[0]?.type === 'Literal' &&
          typeof node.arguments[0].value === 'string'
        ) {
          specifiers.add(node.arguments[0].value)
        }

        if (
          node.type === 'ImportExpression' &&
          node.source?.type === 'Literal' &&
          typeof node.source.value === 'string'
        ) {
          specifiers.add(node.source.value)
        }

        if (
          (node.type === 'ImportDeclaration' ||
            node.type === 'ExportAllDeclaration' ||
            node.type === 'ExportNamedDeclaration') &&
          typeof node.source?.value === 'string'
        ) {
          specifiers.add(node.source.value)
        }
      }

      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
          visitNode(value)
        }
      }
    }

    visitNode(ast)

    return [...specifiers]
  } catch (_error) {
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
}

const isCreateRequireCall = (node) => {
  if (!node || typeof node !== 'object') {
    return false
  }

  if (node.type === 'SequenceExpression') {
    const lastExpression = node.expressions?.[node.expressions.length - 1]
    return isCreateRequireCall(lastExpression)
  }

  if (node.type === 'Identifier' && node.name === 'createRequire') {
    return true
  }

  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property?.type === 'Identifier' &&
    node.property.name === 'createRequire'
  ) {
    return true
  }

  return false
}

const extractCreateRequireSpecifiers = (source) => {
  const specifiers = new Set()

  try {
    const ast = acorn.parse(source, {
      allowHashBang: true,
      ecmaVersion: 'latest',
      sourceType: 'script'
    })

    const createRequireAliases = new Set()

    const isAliasedCreateRequire = (node) =>
      node?.type === 'Identifier' && createRequireAliases.has(node.name)

    const addSpecifierFromArgument = (node) => {
      if (node?.arguments?.[0]?.type === 'Literal' && typeof node.arguments[0].value === 'string') {
        specifiers.add(node.arguments[0].value)
      }
    }

    const visitNode = (node) => {
      if (!node || typeof node !== 'object') {
        return
      }

      if (Array.isArray(node)) {
        for (const child of node) {
          visitNode(child)
        }
        return
      }

      if (
        node.type === 'VariableDeclarator' &&
        node.id?.type === 'Identifier' &&
        node.init?.type === 'CallExpression' &&
        isCreateRequireCall(node.init.callee)
      ) {
        createRequireAliases.add(node.id.name)
      }

      if (
        node.type === 'AssignmentExpression' &&
        node.operator === '=' &&
        node.left?.type === 'Identifier' &&
        node.right?.type === 'CallExpression' &&
        isCreateRequireCall(node.right.callee)
      ) {
        createRequireAliases.add(node.left.name)
      }

      if (
        node.type === 'CallExpression' &&
        node.callee?.type === 'CallExpression' &&
        isCreateRequireCall(node.callee.callee) &&
        node.arguments?.[0]?.type === 'Literal' &&
        typeof node.arguments[0].value === 'string'
      ) {
        specifiers.add(node.arguments[0].value)
      }

      if (node.type === 'CallExpression' && isAliasedCreateRequire(node.callee)) {
        addSpecifierFromArgument(node)
      }

      if (
        node.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        !node.callee.computed &&
        node.callee.property?.type === 'Identifier' &&
        node.callee.property.name === 'resolve' &&
        (isAliasedCreateRequire(node.callee.object) ||
          (node.callee.object?.type === 'CallExpression' && isCreateRequireCall(node.callee.object.callee)))
      ) {
        addSpecifierFromArgument(node)
      }

      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
          visitNode(value)
        }
      }
    }

    visitNode(ast)

    return [...specifiers]
  } catch (_error) {
    const patterns = [
      /createRequire\([^)]*\)\((['"`])([^'"`]+)\1\)/g,
      /createRequire\([^)]*\)\.resolve\((['"`])([^'"`]+)\1\)/g,
      /\brequire[A-Za-z0-9_$]*\.resolve\((['"`])([^'"`]+)\1\)/g
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
}

const extractBarePackageSpecifiers = (source) => {
  const packageNames = new Set()

  for (const specifier of [...extractSpecifiers(source), ...extractCreateRequireSpecifiers(source)]) {
    const packageName = normalizePackageName(specifier)
    if (packageName && !builtinModules.has(packageName)) {
      packageNames.add(packageName)
    }
  }

  return [...packageNames]
}

const resolveRuntimeRelativeSpecifier = (entryFile, specifier) => {
  const basePath = path.resolve(path.dirname(entryFile), specifier)
  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.cjs`,
    `${basePath}.mjs`,
    `${basePath}.json`,
    `${basePath}.node`,
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.cjs'),
    path.join(basePath, 'index.mjs'),
    path.join(basePath, 'index.json'),
    path.join(basePath, 'index.node')
  ]

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

const getStartupEntryFiles = () =>
  [path.join(projectRoot, 'out/main/index.js'), path.join(projectRoot, 'out/proxy/index.js')].filter((file) =>
    fs.existsSync(file)
  )

const findPackageManifestPath = (startDir) => {
  let currentDir = startDir

  while (true) {
    const manifestPath = path.join(currentDir, 'package.json')
    if (fs.existsSync(manifestPath)) {
      return manifestPath
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      return null
    }

    currentDir = parentDir
  }
}

const resolvePackageInfo = (packageName, basedir) => {
  let manifestPath

  try {
    manifestPath = require.resolve(`${packageName}/package.json`, { paths: [basedir] })
  } catch (error) {
    const resolvedEntryPath = require.resolve(packageName, { paths: [basedir] })
    manifestPath = findPackageManifestPath(path.dirname(resolvedEntryPath))

    if (!manifestPath) {
      throw error
    }
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  if (!manifest.name) {
    throw new Error(`Package ${packageName} does not declare a name in ${manifestPath}`)
  }

  return {
    manifest,
    manifestPath,
    packageName: manifest.name,
    packageRoot: path.dirname(manifestPath)
  }
}

const resolvePackageRoot = (packageName, basedir) => resolvePackageInfo(packageName, basedir).packageRoot

const getManifestDependencyNames = (manifest) => [
  ...Object.keys(manifest.dependencies || {}),
  ...Object.keys(manifest.optionalDependencies || {})
]

const collectPackageDependencyClosure = (packageNames, basedir = projectRoot) => {
  const queue = [...new Set(packageNames)].map((packageName) => ({ basedir, packageName }))
  const packageNamesInClosure = new Set()
  const parents = new Map()
  const skippedPackages = new Set()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) {
      continue
    }

    let packageInfo
    try {
      packageInfo = resolvePackageInfo(current.packageName, current.basedir)
    } catch (_error) {
      skippedPackages.add(current.packageName)
      continue
    }

    if (packageNamesInClosure.has(packageInfo.packageName)) {
      continue
    }

    packageNamesInClosure.add(packageInfo.packageName)

    for (const dependencyName of getManifestDependencyNames(packageInfo.manifest)) {
      let dependencyInfo
      try {
        dependencyInfo = resolvePackageInfo(dependencyName, packageInfo.packageRoot)
      } catch (_error) {
        skippedPackages.add(dependencyName)
        continue
      }

      if (!parents.has(dependencyInfo.packageName)) {
        parents.set(dependencyInfo.packageName, packageInfo.packageName)
      }

      queue.push({
        basedir: packageInfo.packageRoot,
        packageName: dependencyInfo.packageName
      })
    }
  }

  return {
    packageNames: packageNamesInClosure,
    parents,
    skippedPackages
  }
}

const mergeDependencyClosures = (closures) => {
  const packageNames = new Set()
  const parents = new Map()
  const skippedPackages = new Set()

  for (const closure of closures) {
    for (const packageName of closure.packageNames) {
      packageNames.add(packageName)
    }

    for (const [packageName, parentName] of closure.parents.entries()) {
      if (!parents.has(packageName)) {
        parents.set(packageName, parentName)
      }
    }

    for (const packageName of closure.skippedPackages) {
      skippedPackages.add(packageName)
    }
  }

  return {
    packageNames,
    parents,
    skippedPackages
  }
}

const auditStartupBundleExternalReferences = ({
  declaredExternalPackages = getRuntimeExternalPackageNames(),
  entryFiles = getStartupEntryFiles()
} = {}) => {
  validateRuntimeExternalPackages(declaredExternalPackages)

  if (entryFiles.length === 0) {
    throw new Error('No startup entry dependencies were found in out/main/index.js or out/proxy/index.js')
  }

  const declaredPackageSet = new Set(declaredExternalPackages)
  const missingBundledRelativeSpecifiers = []
  const skippedPackages = new Set()
  const startupRoots = new Set()
  const undeclaredPackageNames = new Set()

  for (const file of entryFiles) {
    const source = fs.readFileSync(file, 'utf8')
    const localRequire = Module.createRequire(file)

    for (const specifier of extractCreateRequireSpecifiers(source)) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        continue
      }

      if (!resolveRuntimeRelativeSpecifier(file, specifier)) {
        missingBundledRelativeSpecifiers.push({
          entryFile: file,
          specifier
        })
      }
    }

    for (const packageName of extractBarePackageSpecifiers(source)) {
      startupRoots.add(packageName)

      if (declaredPackageSet.has(packageName)) {
        continue
      }

      try {
        localRequire.resolve(packageName, { paths: [path.dirname(file)] })
        undeclaredPackageNames.add(packageName)
      } catch (_error) {
        skippedPackages.add(packageName)
      }
    }
  }

  return {
    declaredExternalPackages: [...declaredPackageSet].sort(),
    missingBundledRelativeSpecifiers,
    skippedPackages,
    startupRoots: [...startupRoots].sort(),
    undeclaredPackageNames: [...undeclaredPackageNames].sort()
  }
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

const resolveResourcesDir = (appOutDir) => {
  const directResourcesDir = path.join(appOutDir, 'Contents/Resources')
  if (fs.existsSync(directResourcesDir)) {
    return directResourcesDir
  }

  const electronResourcesDir = path.join(appOutDir, 'resources')
  if (fs.existsSync(electronResourcesDir)) {
    return electronResourcesDir
  }

  if (!fs.existsSync(appOutDir) || !fs.statSync(appOutDir).isDirectory()) {
    throw new Error(`Unable to locate packaged app output at ${appOutDir}`)
  }

  const appBundle = fs
    .readdirSync(appOutDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.endsWith('.app'))

  if (!appBundle) {
    throw new Error(
      `Unable to locate app resources inside ${appOutDir} (expected Contents/Resources, resources/, or *.app/Contents/Resources)`
    )
  }

  const bundledResourcesDir = path.join(appOutDir, appBundle.name, 'Contents/Resources')
  if (!fs.existsSync(bundledResourcesDir)) {
    throw new Error(`Unable to locate Resources directory inside ${path.join(appOutDir, appBundle.name)}`)
  }

  return bundledResourcesDir
}

const collectPackagedPackageLocations = (appOutDir) => {
  const archivePackageNames = new Set()
  const unpackedPackageNames = new Set()
  const fallbackPackageNames = new Set()
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
        archivePackageNames.add(packageName)
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
            unpackedPackageNames.add(packageName)
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
            fallbackPackageNames.add(packageName)
          }
        }
      }
    }
  }

  return {
    archivePackageNames,
    fallbackPackageNames,
    packagedPackageNames: new Set([...archivePackageNames, ...unpackedPackageNames, ...fallbackPackageNames]),
    primaryPackagedPackageNames: new Set([...archivePackageNames, ...unpackedPackageNames]),
    unpackedPackageNames
  }
}

const computeFallbackPackageNames = ({ expectedPackages, primaryPackagedPackageNames }) =>
  new Set([...expectedPackages].filter((packageName) => !primaryPackagedPackageNames.has(packageName)))

const formatDependencyChain = (packageName, parents) => {
  const chain = [packageName]
  let current = parents.get(packageName)

  while (current) {
    chain.unshift(current)
    current = parents.get(current)
  }

  return chain.join(' -> ')
}

const analyzePackagedRuntimeDependencies = (appOutDir) => {
  const audit = auditStartupBundleExternalReferences()
  const referencedDeclaredExternalPackages = audit.startupRoots.filter((packageName) =>
    audit.declaredExternalPackages.includes(packageName)
  )
  const dedicatedRuntimeRoots = getArtifactRuntimeRootPackageNames()
  const closure = mergeDependencyClosures([
    collectPackageDependencyClosure(referencedDeclaredExternalPackages, projectRoot),
    collectPackageDependencyClosure(dedicatedRuntimeRoots, projectRoot)
  ])
  const packageLocations = collectPackagedPackageLocations(appOutDir)
  const fallbackRequiredPackages = computeFallbackPackageNames({
    expectedPackages: closure.packageNames,
    primaryPackagedPackageNames: packageLocations.primaryPackagedPackageNames
  })
  const missingPackages = [...fallbackRequiredPackages]
    .filter((packageName) => !packageLocations.fallbackPackageNames.has(packageName))
    .sort((left, right) => left.localeCompare(right))
    .map((packageName) => {
      try {
        return {
          availableLocally: true,
          chain: formatDependencyChain(packageName, closure.parents),
          name: packageName,
          sourceDir: resolvePackageRoot(packageName, projectRoot)
        }
      } catch (_error) {
        return {
          availableLocally: false,
          chain: formatDependencyChain(packageName, closure.parents),
          name: packageName,
          sourceDir: null
        }
      }
    })

  return {
    audit,
    dedicatedRuntimeRoots,
    expectedPackages: closure.packageNames,
    fallbackRequiredPackages,
    missingPackages,
    packagedPackages: packageLocations.packagedPackageNames,
    packageLocations,
    startupRoots: audit.startupRoots
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

  if (analysis.audit.undeclaredPackageNames.length > 0) {
    throw new Error(
      `Startup bundles reference undeclared runtime external packages.\n` +
        `Declare them in scripts/runtime-external-packages.js or bundle them.\n` +
        `Undeclared packages: ${analysis.audit.undeclaredPackageNames.join(', ')}\n`
    )
  }

  if (analysis.audit.missingBundledRelativeSpecifiers.length > 0) {
    const details = analysis.audit.missingBundledRelativeSpecifiers
      .map(({ entryFile, specifier }) => `- ${path.relative(projectRoot, entryFile)} -> ${specifier}`)
      .join('\n')
    throw new Error(
      `Startup bundles reference relative runtime files that are not emitted beside the bundle.\n` +
        `Externalize the owning package or ship the missing files.\n` +
        `${details}\n`
    )
  }

  if (actionableMissingPackages.length > 0) {
    const details = actionableMissingPackages.map((pkg) => `- ${pkg.chain}`).join('\n')
    throw new Error(
      `Packaged app is missing declared runtime external dependencies required during startup.\n` +
        `Startup roots: ${analysis.startupRoots.join(', ')}\n` +
        `Missing packages available in local node_modules:\n${details}\n`
    )
  }

  if (analysis.audit.skippedPackages.size > 0) {
    process.stdout.write(
      `[verify-packaged-runtime-deps] Skipped unresolved startup references: ${[...analysis.audit.skippedPackages].sort().join(', ')}\n`
    )
  }

  if (unavailableMissingPackages.length > 0) {
    const details = unavailableMissingPackages.map((pkg) => pkg.chain).join(', ')
    process.stdout.write(
      `[verify-packaged-runtime-deps] Ignoring unavailable declared runtime externals on this machine: ${details}\n`
    )
  }

  process.stdout.write(
    `[verify-packaged-runtime-deps] Verified ${analysis.expectedPackages.size} declared startup runtime packages in ${appOutDir}\n`
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
  auditStartupBundleExternalReferences,
  collectPackageDependencyClosure,
  computeFallbackPackageNames,
  copyMissingStartupRuntimeDependencies,
  verifyPackagedRuntimeDependencies
}
