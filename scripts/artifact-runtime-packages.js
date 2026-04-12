const { validateRuntimeExternalPackages } = require('./runtime-external-packages')

const artifactRuntimeRootPackages = Object.freeze([
  'clsx',
  'lucide-react',
  'react',
  'react-dom',
  'scheduler',
  'tailwind-merge'
])

validateRuntimeExternalPackages(artifactRuntimeRootPackages)

const getArtifactRuntimeRootPackageNames = () => [...artifactRuntimeRootPackages]

module.exports = {
  artifactRuntimeRootPackages,
  getArtifactRuntimeRootPackageNames
}
