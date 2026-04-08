import { getDefaultArtifactSettings } from '@shared/artifacts'
import { describe, expect, it } from 'vitest'

import { buildHtmlArtifactPreviewDocument, parseArtifactDirectiveOverrides } from '../config'

describe('artifact config helpers', () => {
  it('parses HTML directive overrides from meta tags', () => {
    const overrides = parseArtifactDirectiveOverrides(
      'html',
      '<meta name="artifact-theme" content="ocean" /><meta name="artifact-network" content="off" /><meta name="artifact-services" content="prod-db, analytics" />'
    )

    expect(overrides).toEqual({
      themeId: 'ocean',
      internetEnabled: false,
      serviceIds: ['prod-db', 'analytics']
    })
  })

  it('injects preset libraries into enhanced HTML artifacts', () => {
    const document = buildHtmlArtifactPreviewDocument({
      source: '<div id="app"></div>',
      title: 'HTMX + Alpine',
      runtimeProfileId: 'html+htmx+alpine',
      settings: getDefaultArtifactSettings(),
      overrides: {}
    })

    expect(document).toContain('htmx.org@2.0.9')
    expect(document).toContain('alpinejs@3.15.0')
    expect(document).toContain('artifactServices')
  })

  it('normalizes managed and malformed external library references', () => {
    const document = buildHtmlArtifactPreviewDocument({
      source: `
        <script src="cdn.jsdelivr.net/npm/htmx.org@1.9.12"></script>
        <script src="//unpkg.com/alpinejs@3.14.0/dist/cdn.min.js"></script>
        <script src="//cdn.jsdelivr.net/npm/some-lib@1.0.0/dist/index.js"></script>
      `,
      title: 'Normalized Libraries',
      runtimeProfileId: 'html',
      settings: getDefaultArtifactSettings(),
      overrides: {}
    })

    expect(document).toContain('https://cdn.jsdelivr.net/npm/htmx.org@2.0.9/dist/htmx.min.js')
    expect(document).toContain('https://cdn.jsdelivr.net/npm/alpinejs@3.15.0/dist/cdn.min.js')
    expect(document).toContain('https://cdn.jsdelivr.net/npm/some-lib@1.0.0/dist/index.js')
    expect(document).not.toContain('src="cdn.jsdelivr.net/npm/htmx.org@1.9.12"')
    expect(document).not.toContain('src="//unpkg.com/alpinejs@3.14.0/dist/cdn.min.js"')
  })
})
