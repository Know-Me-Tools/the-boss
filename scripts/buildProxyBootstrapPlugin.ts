import { builtinModules } from 'node:module'

import { resolve } from 'path'
import { build as viteBuild, type Plugin } from 'vite'

import { getRuntimeExternalPackageNames } from './runtime-external-packages.js'

interface BuildProxyBootstrapPluginOptions {
  isProd: boolean
  rootDir: string
}

const runtimeExternalPackages = getRuntimeExternalPackageNames()
const proxyRollupExternals = [
  'bufferutil',
  'electron',
  /^electron\/.+/,
  'utf-8-validate',
  ...builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`]),
  ...runtimeExternalPackages
]

export const buildProxyBootstrapPlugin = ({ isProd, rootDir }: BuildProxyBootstrapPluginOptions): Plugin => {
  return {
    name: 'cherry-build-proxy-bootstrap',
    apply: 'build',
    async closeBundle() {
      await viteBuild({
        configFile: false,
        publicDir: false,
        resolve: {
          mainFields: ['module', 'jsnext:main', 'jsnext'],
          conditions: ['node']
        },
        build: {
          outDir: resolve(rootDir, 'out/proxy'),
          target: 'node22',
          minify: false,
          reportCompressedSize: false,
          copyPublicDir: false,
          lib: {
            entry: resolve(rootDir, 'src/main/services/proxy/bootstrap.ts'),
            formats: ['cjs'],
            fileName: () => 'index.js'
          },
          rollupOptions: {
            external: proxyRollupExternals
          }
        },
        esbuild: isProd ? { legalComments: 'none' } : {}
      })
    }
  }
}
