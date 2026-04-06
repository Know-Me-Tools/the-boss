import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import { loggerService } from '@logger'
import {
  ARTIFACT_PACKAGE_REGISTRY,
  ARTIFACT_THEME_PRESETS,
  ArtifactLibraryFileSchema,
  ArtifactLibraryQuerySchema,
  type ArtifactRecord,
  ArtifactRecordDraftSchema,
  CompileReactArtifactRequestSchema,
  type CompileReactArtifactResponse,
  HTML_ARTIFACT_RUNTIME_PROFILES,
  REACT_ARTIFACT_RUNTIME_PROFILES,
  UpdateArtifactMetadataRequestSchema
} from '@shared/artifacts'
import { app } from 'electron'

import { getDataPath } from '../utils'
import { writeWithLock } from '../utils/file'

const logger = loggerService.withContext('ArtifactService')
const require = createRequire(import.meta.url)

const APPROVED_REACT_IMPORTS = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'scheduler',
  'lucide-react',
  'clsx',
  'tailwind-merge'
])

const ARTIFACT_UI_MODULES: Record<string, string> = {
  '@artifact-ui/utils': `
    import { clsx } from 'clsx'
    import { twMerge } from 'tailwind-merge'

    export function cn(...inputs) {
      return twMerge(clsx(inputs))
    }
  `,
  '@artifact-ui/button': `
    import React from 'react'
    import { cn } from '@artifact-ui/utils'

    export const buttonVariants = {
      default: 'artifact-ui-button--default',
      secondary: 'artifact-ui-button--secondary',
      ghost: 'artifact-ui-button--ghost',
      outline: 'artifact-ui-button--outline'
    }

    export function Button({
      className,
      variant = 'default',
      size = 'default',
      ...props
    }) {
      return (
        <button
          className={cn(
            'artifact-ui-button',
            buttonVariants[variant] || buttonVariants.default,
            size === 'sm' && 'artifact-ui-button--sm',
            size === 'lg' && 'artifact-ui-button--lg',
            className
          )}
          {...props}
        />
      )
    }
  `,
  '@artifact-ui/card': `
    import React from 'react'
    import { cn } from '@artifact-ui/utils'

    export function Card({ className, ...props }) {
      return <div className={cn('artifact-ui-card', className)} {...props} />
    }

    export function CardHeader({ className, ...props }) {
      return <div className={cn('artifact-ui-card__header', className)} {...props} />
    }

    export function CardTitle({ className, ...props }) {
      return <h3 className={cn('artifact-ui-card__title', className)} {...props} />
    }

    export function CardDescription({ className, ...props }) {
      return <p className={cn('artifact-ui-card__description', className)} {...props} />
    }

    export function CardContent({ className, ...props }) {
      return <div className={cn('artifact-ui-card__content', className)} {...props} />
    }

    export function CardFooter({ className, ...props }) {
      return <div className={cn('artifact-ui-card__footer', className)} {...props} />
    }
  `,
  '@artifact-ui/badge': `
    import React from 'react'
    import { cn } from '@artifact-ui/utils'

    export function Badge({ className, variant = 'default', ...props }) {
      return (
        <span
          className={cn(
            'artifact-ui-badge',
            variant === 'secondary' && 'artifact-ui-badge--secondary',
            variant === 'outline' && 'artifact-ui-badge--outline',
            className
          )}
          {...props}
        />
      )
    }
  `,
  '@artifact-ui/input': `
    import React from 'react'
    import { cn } from '@artifact-ui/utils'

    export const Input = React.forwardRef(function Input({ className, ...props }, ref) {
      return <input ref={ref} className={cn('artifact-ui-input', className)} {...props} />
    })
  `
}

function formatDiagnostic(error: unknown): string[] {
  if (typeof error === 'object' && error && 'errors' in error && Array.isArray((error as any).errors)) {
    return (error as any).errors.map((entry: any) => {
      const location = entry.location
        ? `${entry.location.file || 'artifact'}:${entry.location.line}:${entry.location.column}`
        : 'artifact'
      return `${location} ${entry.text}`
    })
  }

  if (error instanceof Error) {
    return [error.message]
  }

  return [String(error)]
}

function getBootstrapEntry({ baseCss, themeCss, customCss }: { baseCss: string; themeCss: string; customCss: string }) {
  const combinedCss = `${baseCss}\n${themeCss}\n${customCss}`

  return `
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import * as UserModule from 'virtual:user-entry'

    const host = document.getElementById('__artifact-host')
    if (!host) {
      throw new Error('Missing artifact host element.')
    }

    const shadowRoot = host.shadowRoot || host.attachShadow({ mode: 'open' })
    shadowRoot.innerHTML = ''

    const mount = document.createElement('div')
    mount.id = '__artifact-root'
    shadowRoot.appendChild(mount)

    const combinedCss = ${JSON.stringify(combinedCss)}
    if ('adoptedStyleSheets' in shadowRoot && typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(combinedCss)
      shadowRoot.adoptedStyleSheets = [sheet]
    } else {
      const style = document.createElement('style')
      style.textContent = combinedCss
      shadowRoot.prepend(style)
    }

    const candidate = UserModule.default || UserModule.App || UserModule.Component
    const AppComponent =
      typeof candidate === 'function'
        ? candidate
        : function MissingDefaultExport() {
            return React.createElement(
              'pre',
              {
                style: {
                  padding: '16px',
                  whiteSpace: 'pre-wrap',
                  color: 'var(--artifact-danger)'
                }
              },
              'React artifacts must export a default component.'
            )
          }

    createRoot(mount).render(
      React.createElement(React.StrictMode, null, React.createElement(AppComponent))
    )
  `
}

export class ArtifactService {
  constructor(private readonly options: { libraryPath?: string; useLocking?: boolean } = {}) {}

  private getLibraryPath() {
    return this.options.libraryPath ?? path.join(getDataPath('Artifacts'), 'library.json')
  }

  private async readLibrary() {
    const filePath = this.getLibraryPath()

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return ArtifactLibraryFileSchema.parse(JSON.parse(content))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return ArtifactLibraryFileSchema.parse({})
      }

      logger.error('Failed to read artifact library', error as Error)
      throw error
    }
  }

  private async writeLibrary(artifacts: ArtifactRecord[]) {
    const filePath = this.getLibraryPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const content = `${JSON.stringify({ version: 1, artifacts }, null, 2)}\n`

    if (this.options.useLocking === false) {
      await fs.writeFile(filePath, content, 'utf-8')
      return
    }

    await writeWithLock(filePath, content, {
      atomic: true,
      encoding: 'utf-8'
    })
  }

  listRuntimeProfiles() {
    return {
      html: HTML_ARTIFACT_RUNTIME_PROFILES,
      react: REACT_ARTIFACT_RUNTIME_PROFILES
    }
  }

  listThemes() {
    return ARTIFACT_THEME_PRESETS
  }

  listPackageRegistry() {
    return ARTIFACT_PACKAGE_REGISTRY
  }

  async saveArtifact(input: unknown): Promise<ArtifactRecord> {
    const draft = ArtifactRecordDraftSchema.parse(input)
    const versionId = randomUUID()
    const recordId = randomUUID()
    const timestamp = new Date().toISOString()
    const record: ArtifactRecord = {
      id: recordId,
      title: draft.title,
      kind: draft.kind,
      runtimeProfileId: draft.runtimeProfileId,
      sourceLanguage: draft.sourceLanguage,
      latestSource: draft.source,
      themeId: draft.themeId,
      accessPolicy: draft.accessPolicy,
      createdAt: timestamp,
      updatedAt: timestamp,
      currentVersionId: versionId,
      versions: [
        {
          id: versionId,
          createdAt: timestamp,
          source: draft.source,
          sourceLanguage: draft.sourceLanguage,
          runtimeProfileId: draft.runtimeProfileId,
          themeId: draft.themeId,
          accessPolicy: draft.accessPolicy,
          origin: draft.origin
        }
      ],
      origin: draft.origin,
      exportMetadata: {
        status: 'not-exported',
        schemaVersion: 'a2ui-draft'
      }
    }

    const library = await this.readLibrary()
    const artifacts = [record, ...library.artifacts].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )
    await this.writeLibrary(artifacts)
    return record
  }

  async listArtifacts(input?: unknown): Promise<ArtifactRecord[]> {
    const query = ArtifactLibraryQuerySchema.parse(input ?? {})
    const library = await this.readLibrary()
    const search = query.search?.trim().toLowerCase()

    return library.artifacts
      .filter((artifact) => {
        if (query.kind && artifact.kind !== query.kind) {
          return false
        }

        if (!search) {
          return true
        }

        return (
          artifact.title.toLowerCase().includes(search) ||
          artifact.latestSource.toLowerCase().includes(search) ||
          artifact.runtimeProfileId.toLowerCase().includes(search)
        )
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async getArtifact(id: string): Promise<ArtifactRecord | null> {
    const library = await this.readLibrary()
    return library.artifacts.find((artifact) => artifact.id === id) ?? null
  }

  async updateArtifactMetadata(input: unknown): Promise<ArtifactRecord> {
    const request = UpdateArtifactMetadataRequestSchema.parse(input)
    const library = await this.readLibrary()
    const timestamp = new Date().toISOString()
    let updatedRecord: ArtifactRecord | null = null

    const artifacts = library.artifacts.map((artifact) => {
      if (artifact.id !== request.id) {
        return artifact
      }

      updatedRecord = {
        ...artifact,
        ...request.patch,
        updatedAt: timestamp
      }

      return updatedRecord
    })

    if (!updatedRecord) {
      throw new Error(`Unknown artifact "${request.id}".`)
    }

    await this.writeLibrary(artifacts)
    return updatedRecord
  }

  async forkArtifact(id: string): Promise<ArtifactRecord> {
    const source = await this.getArtifact(id)
    if (!source) {
      throw new Error(`Unknown artifact "${id}".`)
    }

    const timestamp = new Date().toISOString()
    const versionId = randomUUID()
    const forked: ArtifactRecord = {
      ...source,
      id: randomUUID(),
      title: `${source.title} Copy`,
      createdAt: timestamp,
      updatedAt: timestamp,
      currentVersionId: versionId,
      versions: [
        {
          id: versionId,
          createdAt: timestamp,
          source: source.latestSource,
          sourceLanguage: source.sourceLanguage,
          runtimeProfileId: source.runtimeProfileId,
          themeId: source.themeId,
          accessPolicy: source.accessPolicy,
          origin: source.origin
        }
      ],
      sourceArtifactId: source.id
    }

    const library = await this.readLibrary()
    await this.writeLibrary([forked, ...library.artifacts])
    return forked
  }

  async deleteArtifact(id: string): Promise<boolean> {
    const library = await this.readLibrary()
    const nextArtifacts = library.artifacts.filter((artifact) => artifact.id !== id)

    if (nextArtifacts.length === library.artifacts.length) {
      return false
    }

    await this.writeLibrary(nextArtifacts)
    return true
  }

  /**
   * Resolve and pin the esbuild binary path before the first spawn.
   *
   * Problem: esbuild's JS API internally calls `require.resolve('@esbuild/<platform>/bin/esbuild')`
   * from inside its own `node_modules/esbuild/lib/main.js`. In a packaged Electron app the
   * `node_modules/esbuild` directory sits inside the asar archive, so `require.resolve` may
   * return a virtual asar path (e.g. `.../app.asar/node_modules/@esbuild/...`).
   * `child_process.spawn` cannot open paths inside an asar file and throws ENOTDIR.
   *
   * Fix: resolve the binary path ourselves using the `createRequire` that was created relative
   * to this module (and therefore has the correct package-resolution roots), then rewrite any
   * `.asar/` component to `.asar.unpacked/` so the path points to the real file on disk.
   * `electron-builder.yml` already puts `node_modules/@esbuild/**` in asarUnpack, so the
   * binary is always physically present at the unpacked location.
   */
  private ensureEsbuildBinaryPath(): void {
    if (process.env.ESBUILD_BINARY_PATH) return

    const platformPkg = `@esbuild/${process.platform}-${process.arch}`
    const binaryName = process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'

    try {
      let binPath = require.resolve(`${platformPkg}/${binaryName}`)

      // Rewrite asar path → unpacked path so spawn() can access the binary
      const asarMarker = `${path.sep}app.asar${path.sep}`
      if (binPath.includes(asarMarker)) {
        binPath = binPath.replace(asarMarker, `${path.sep}app.asar.unpacked${path.sep}`)
      }

      process.env.ESBUILD_BINARY_PATH = binPath
      logger.info('Resolved esbuild binary path', { binPath })
    } catch (err) {
      logger.warn('Could not resolve esbuild binary path; esbuild will use its own resolution', err as Error)
    }
  }

  async compileReactArtifact(input: unknown): Promise<CompileReactArtifactResponse> {
    const request = CompileReactArtifactRequestSchema.parse(input)
    const entry = getBootstrapEntry(request)

    try {
      this.ensureEsbuildBinaryPath()
      const { build } = await import('esbuild')
      // Use Electron's temp directory as working directory for esbuild
      // This is more reliable than process.cwd() in Electron environments
      // where cwd might point to an asar archive or be inaccessible
      const workingDir = app.getPath('temp')
      const result = await build({
        absWorkingDir: workingDir,
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'iife',
        target: ['chrome120'],
        jsx: 'automatic',
        logLevel: 'silent',
        entryPoints: ['artifact:entry'],
        plugins: [
          {
            name: 'artifact-runtime',
            setup(buildApi) {
              buildApi.onResolve({ filter: /^artifact:entry$/ }, () => ({
                path: 'artifact:entry',
                namespace: 'artifact'
              }))

              buildApi.onResolve({ filter: /^virtual:user-entry$/ }, () => ({
                path: 'virtual:user-entry',
                namespace: 'artifact'
              }))

              buildApi.onResolve({ filter: /^@artifact-ui\// }, (args) => {
                if (!(args.path in ARTIFACT_UI_MODULES)) {
                  return {
                    errors: [{ text: `Import "${args.path}" is not available in the artifact registry.` }]
                  }
                }

                return {
                  path: args.path,
                  namespace: 'artifact'
                }
              })

              buildApi.onResolve({ filter: /^[^./].*/ }, (args) => {
                if (args.path.startsWith('@artifact-ui/')) {
                  return {
                    path: args.path,
                    namespace: 'artifact'
                  }
                }

                if (APPROVED_REACT_IMPORTS.has(args.path)) {
                  return {
                    path: require.resolve(args.path)
                  }
                }

                return {
                  errors: [{ text: `Import "${args.path}" is not allowed in React artifacts.` }]
                }
              })

              buildApi.onResolve({ filter: /^\./ }, (args) => {
                if (args.importer === 'virtual:user-entry') {
                  return {
                    errors: [{ text: 'Relative imports are not supported in single-file React artifacts.' }]
                  }
                }

                return null
              })

              buildApi.onLoad({ filter: /^artifact:entry$/, namespace: 'artifact' }, () => ({
                contents: entry,
                loader: 'tsx'
              }))

              buildApi.onLoad({ filter: /^virtual:user-entry$/, namespace: 'artifact' }, () => ({
                contents: request.source,
                loader: 'tsx'
              }))

              buildApi.onLoad({ filter: /^@artifact-ui\//, namespace: 'artifact' }, (args) => ({
                contents: ARTIFACT_UI_MODULES[args.path],
                loader: 'tsx'
              }))
            }
          }
        ]
      })

      const script = result.outputFiles[0]?.text ?? ''

      return {
        ok: true,
        script,
        diagnostics: []
      }
    } catch (error) {
      const diagnostics = formatDiagnostic(error)
      logger.warn('Failed to compile React artifact', { diagnostics })
      return {
        ok: false,
        script: '',
        diagnostics
      }
    }
  }
}

export const artifactService = new ArtifactService()
