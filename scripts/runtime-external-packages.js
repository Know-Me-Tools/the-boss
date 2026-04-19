const PACKAGE_NAME_PATTERN = /^(?:@[\w.-]+\/)?[\w.-]+$/

const runtimeExternalPackages = Object.freeze([
  '@anush008/tokenizers',
  '@anthropic-ai/claude-agent-sdk',
  '@libsql/client',
  '@mastra/fastembed',
  '@napi-rs/canvas',
  '@napi-rs/system-ocr',
  'esbuild',
  'fastembed',
  'font-list',
  'onnxruntime-node',
  'openai-oauth',
  'selection-hook',
  'sharp'
])

const validateRuntimeExternalPackages = (packageNames) => {
  const seen = new Set()

  for (const packageName of packageNames) {
    if (!PACKAGE_NAME_PATTERN.test(packageName)) {
      throw new Error(`Invalid runtime external package name: ${packageName}`)
    }

    if (seen.has(packageName)) {
      throw new Error(`Duplicate runtime external package name: ${packageName}`)
    }

    seen.add(packageName)
  }
}

validateRuntimeExternalPackages(runtimeExternalPackages)

const getRuntimeExternalPackageNames = () => [...runtimeExternalPackages]

module.exports = {
  getRuntimeExternalPackageNames,
  runtimeExternalPackages,
  validateRuntimeExternalPackages
}
