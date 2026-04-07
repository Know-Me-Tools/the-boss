const fs = require('fs')
const path = require('path')
const {
  copyMissingStartupRuntimeDependencies,
  verifyPackagedRuntimeDependencies
} = require('./verify-packaged-runtime-deps')

exports.default = async function (context) {
  const platform = context.packager.platform.name
  for (const legacyStartupModulesDir of [
    path.join(context.appOutDir, 'Contents', 'Resources', 'startup-node-modules'),
    path.join(context.appOutDir, 'resources', 'startup-node-modules')
  ]) {
    fs.rmSync(legacyStartupModulesDir, { force: true, recursive: true })
  }

  const { copiedPackages } = copyMissingStartupRuntimeDependencies(context.appOutDir)
  if (copiedPackages.length > 0) {
    process.stdout.write(`[after-pack] Copied startup runtime fallback packages: ${copiedPackages.sort().join(', ')}\n`)
  }

  verifyPackagedRuntimeDependencies(context.appOutDir)

  if (platform === 'windows') {
    fs.rmSync(path.join(context.appOutDir, 'LICENSE.electron.txt'), { force: true })
    fs.rmSync(path.join(context.appOutDir, 'LICENSES.chromium.html'), { force: true })
  }
}
