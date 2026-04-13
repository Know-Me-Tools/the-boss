import { builtinModules } from 'node:module'

import react from '@vitejs/plugin-react-swc'
import { CodeInspectorPlugin } from 'code-inspector-plugin'
import { defineConfig } from 'electron-vite'
import { resolve } from 'path'

import { buildProxyBootstrapPlugin } from './scripts/buildProxyBootstrapPlugin'
import { getRuntimeExternalPackageNames } from './scripts/runtime-external-packages.js'

const visualizerPlugin = async (type: 'renderer' | 'main') => {
  if (!process.env[`VISUALIZER_${type.toUpperCase()}`]) {
    return []
  }

  const { visualizer } = await import('rollup-plugin-visualizer')
  return [visualizer({ open: true })]
}

const isDev = process.env.NODE_ENV === 'development'
const isProd = process.env.NODE_ENV === 'production'
const enableCodeInspector = isDev && process.env.ENABLE_CODE_INSPECTOR === 'true'
const productionEsbuildOptions = { legalComments: 'none' as const }
const rendererWorkerOptions = { format: 'es' as const }
const runtimeExternalPackages = getRuntimeExternalPackageNames()
const nodeModuleExternals = builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`])
const startupRollupExternals = [
  'bufferutil',
  'electron',
  /^electron\/.+/,
  'utf-8-validate',
  ...nodeModuleExternals,
  ...runtimeExternalPackages
]

export default defineConfig(async () => {
  const [mainVisualizerPlugins, rendererVisualizerPlugins] = await Promise.all([
    visualizerPlugin('main'),
    visualizerPlugin('renderer')
  ])

  return {
    main: {
      plugins: [
        ...mainVisualizerPlugins,
        buildProxyBootstrapPlugin({
          isProd,
          rootDir: __dirname
        })
      ],
      resolve: {
        alias: {
          '@main': resolve('src/main'),
          '@types': resolve('src/renderer/src/types'),
          '@shared': resolve('packages/shared'),
          '@logger': resolve('src/main/services/LoggerService'),
          '@cherrystudio/ai-core/provider': resolve('packages/aiCore/src/core/providers'),
          '@cherrystudio/ai-core/built-in/plugins': resolve('packages/aiCore/src/core/plugins/built-in'),
          '@cherrystudio/ai-core': resolve('packages/aiCore/src'),
          '@cherrystudio/ai-sdk-provider': resolve('packages/ai-sdk-provider/src'),
          '@mcp-trace/trace-core': resolve('packages/mcp-trace/trace-core'),
          '@mcp-trace/trace-node': resolve('packages/mcp-trace/trace-node')
        }
      },
      build: {
        externalizeDeps: false,
        rollupOptions: {
          external: startupRollupExternals,
          output: {
            manualChunks: undefined, // 彻底禁用代码分割 - 返回 null 强制单文件打包
            inlineDynamicImports: true // 内联所有动态导入，这是关键配置
          },
          onwarn(warning, warn) {
            if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return
            warn(warning)
          }
        },
        sourcemap: isDev
      },
      esbuild: isProd ? productionEsbuildOptions : undefined,
      optimizeDeps: {
        noDiscovery: isDev
      }
    },
    preload: {
      plugins: [
        react({
          tsDecorators: true
        })
      ],
      resolve: {
        alias: {
          '@shared': resolve('packages/shared'),
          '@mcp-trace/trace-core': resolve('packages/mcp-trace/trace-core')
        }
      },
      build: {
        sourcemap: isDev
      }
    },
    renderer: {
      plugins: [
        (async () => (await import('@tailwindcss/vite')).default())(),
        react({
          tsDecorators: true
        }),
        ...(enableCodeInspector ? [CodeInspectorPlugin({ bundler: 'vite' })] : []),
        ...rendererVisualizerPlugins
      ],
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('packages/shared'),
          '@types': resolve('src/renderer/src/types'),
          '@logger': resolve('src/renderer/src/services/LoggerService'),
          '@mcp-trace/trace-core': resolve('packages/mcp-trace/trace-core'),
          '@mcp-trace/trace-web': resolve('packages/mcp-trace/trace-web'),
          '@cherrystudio/ai-core/provider': resolve('packages/aiCore/src/core/providers'),
          '@cherrystudio/ai-core/built-in/plugins': resolve('packages/aiCore/src/core/plugins/built-in'),
          '@cherrystudio/ai-core': resolve('packages/aiCore/src'),
          '@cherrystudio/extension-table-plus': resolve('packages/extension-table-plus/src'),
          '@cherrystudio/ai-sdk-provider': resolve('packages/ai-sdk-provider/src')
        }
      },
      optimizeDeps: {
        exclude: ['pyodide'],
        esbuildOptions: {
          target: 'esnext' // for dev
        }
      },
      worker: rendererWorkerOptions,
      build: {
        target: 'esnext', // for build
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/renderer/index.html'),
            miniWindow: resolve(__dirname, 'src/renderer/miniWindow.html'),
            selectionToolbar: resolve(__dirname, 'src/renderer/selectionToolbar.html'),
            selectionAction: resolve(__dirname, 'src/renderer/selectionAction.html'),
            traceWindow: resolve(__dirname, 'src/renderer/traceWindow.html')
          },
          onwarn(warning, warn) {
            if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return
            warn(warning)
          }
        }
      },
      esbuild: isProd ? productionEsbuildOptions : undefined
    }
  }
})
