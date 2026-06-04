import fs from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { ArtifactService, getArtifactModuleResolvePaths } from '../ArtifactService'

describe('ArtifactService', () => {
  it('compiles a simple React artifact', async () => {
    const service = new ArtifactService()

    const result = await service.compileReactArtifact({
      source: `
        export default function App() {
          return <div className="artifact-shell">hello</div>
        }
      `,
      baseCss: '',
      themeCss: '',
      customCss: '',
      title: 'Test'
    })

    expect(result.ok).toBe(true)
    expect(result.script).toContain('__artifact-host')
  })

  it('compiles a React artifact that explicitly imports React', async () => {
    const service = new ArtifactService()

    const result = await service.compileReactArtifact({
      source: `
        import React from 'react'

        export default function App() {
          const [count] = React.useState(1)
          return <div className="artifact-shell">count: {count}</div>
        }
      `,
      baseCss: '',
      themeCss: '',
      customCss: '',
      title: 'Explicit React Import'
    })

    expect(result.ok).toBe(true)
    expect(result.script).toContain('count:')
  })

  it('rejects imports outside the approved registry', async () => {
    const service = new ArtifactService()

    const result = await service.compileReactArtifact({
      source: `
        import leftPad from 'left-pad'

        export default function App() {
          return <div>{leftPad('1', 2, '0')}</div>
        }
      `,
      baseCss: '',
      themeCss: '',
      customCss: '',
      title: 'Invalid'
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics.join('\n')).toContain('not allowed')
  })

  it('prefers packaged resources when resolving artifact runtime modules', () => {
    const resolvePaths = getArtifactModuleResolvePaths({
      cwd: '/workspace/project',
      resourcesPath: '/Applications/The Boss.app/Contents/Resources'
    })

    expect(resolvePaths).toEqual(['/Applications/The Boss.app/Contents/Resources', '/workspace/project'])
  })

  it('persists, updates, forks, and deletes artifacts in the local library', async () => {
    const tempDir = await fs.mkdtemp(path.join(process.cwd(), '.artifact-library-'))
    const service = new ArtifactService({ libraryPath: path.join(tempDir, 'library.json'), useLocking: false })

    const saved = await service.saveArtifact({
      title: 'Weather Widget',
      kind: 'react',
      runtimeProfileId: 'react-default',
      sourceLanguage: 'tsx',
      source: 'export default function App() { return <div>Hello</div> }',
      themeId: 'boss-light',
      accessPolicy: {
        internetEnabled: false,
        serviceIds: ['weather']
      },
      origin: {
        messageBlockId: 'block-1',
        codeBlockId: 'code-1'
      }
    })

    const listed = await service.listArtifacts()
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe(saved.id)
    expect(listed[0].versions).toHaveLength(1)
    expect(listed[0].sourceLanguage).toBe('tsx')

    const renamed = await service.updateArtifactMetadata({
      id: saved.id,
      patch: {
        title: 'Weather Widget Renamed'
      }
    })
    expect(renamed.title).toBe('Weather Widget Renamed')

    const updated = await service.updateArtifactSource({
      id: saved.id,
      source: 'export default function App() { return <div>Updated</div> }',
      origin: {
        messageBlockId: 'block-2',
        codeBlockId: 'code-2'
      }
    })
    expect(updated.latestSource).toContain('Updated')
    expect(updated.versions).toHaveLength(2)
    expect(updated.currentVersionId).toBe(updated.versions[1].id)
    expect(updated.versions[0].source).toContain('Hello')
    expect(updated.versions[1].source).toContain('Updated')
    expect(updated.versions[1].origin).toEqual({
      messageBlockId: 'block-2',
      codeBlockId: 'code-2'
    })

    const forked = await service.forkArtifact(saved.id)
    expect(forked.sourceArtifactId).toBe(saved.id)
    expect(forked.versions).toHaveLength(1)

    const afterFork = await service.listArtifacts()
    expect(afterFork).toHaveLength(2)

    const deleted = await service.deleteArtifact(saved.id)
    expect(deleted).toBe(true)
    const afterDelete = await service.listArtifacts()
    expect(afterDelete).toHaveLength(1)

    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('rejects source updates for unknown or invalid artifacts', async () => {
    const tempDir = await fs.mkdtemp(path.join(process.cwd(), '.artifact-library-'))
    const service = new ArtifactService({ libraryPath: path.join(tempDir, 'library.json'), useLocking: false })

    await expect(
      service.updateArtifactSource({
        id: 'missing-artifact',
        source: '<main>Missing</main>'
      })
    ).rejects.toThrow('Unknown artifact "missing-artifact".')

    const saved = await service.saveArtifact({
      title: 'HTML Widget',
      kind: 'html',
      runtimeProfileId: 'html',
      sourceLanguage: 'html',
      source: '<main>Hello</main>',
      themeId: 'boss-light',
      accessPolicy: {
        internetEnabled: true
      }
    })

    await expect(
      service.updateArtifactSource({
        id: saved.id,
        source: ''
      })
    ).rejects.toThrow()

    const unchanged = await service.getArtifact(saved.id)
    expect(unchanged?.versions).toHaveLength(1)
    expect(unchanged?.latestSource).toBe('<main>Hello</main>')

    await fs.rm(tempDir, { recursive: true, force: true })
  })
})
