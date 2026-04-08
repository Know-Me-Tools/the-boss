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

    expect(document).toContain('htmx.org@2.0.8')
    expect(document).toContain('https://unpkg.com/htmx.org@2.0.8/dist/htmx.min.js')
    expect(document).toContain('alpinejs@3.15.0')
    expect(document).toContain('artifactServices')
    expect(document).not.toContain('htmx.org@2.0.9')
  })

  it('normalizes managed and malformed external library references', () => {
    const document = buildHtmlArtifactPreviewDocument({
      source: `
        <script src="cdn.jsdelivr.net/npm/htmx.org@1.9.12"></script>
        <script src="https://unpkg.com/htmx.org@2.0.8/dist/htmx.min.js"></script>
        <script src="//unpkg.com/alpinejs@3.14.0/dist/cdn.min.js"></script>
        <script src="//cdn.jsdelivr.net/npm/some-lib@1.0.0/dist/index.js"></script>
      `,
      title: 'Normalized Libraries',
      runtimeProfileId: 'html+htmx',
      settings: getDefaultArtifactSettings(),
      overrides: {}
    })

    expect(document).toContain('https://cdn.jsdelivr.net/npm/htmx.org@2.0.8/dist/htmx.min.js')
    expect(document).toContain('https://unpkg.com/htmx.org@2.0.8/dist/htmx.min.js')
    expect(document).toContain('https://cdn.jsdelivr.net/npm/alpinejs@3.15.0/dist/cdn.min.js')
    expect(document).toContain('https://cdn.jsdelivr.net/npm/some-lib@1.0.0/dist/index.js')
    expect(document).not.toContain('src="cdn.jsdelivr.net/npm/htmx.org@1.9.12"')
    expect(document).not.toContain('src="//unpkg.com/alpinejs@3.14.0/dist/cdn.min.js"')
    expect(document.match(/htmx\.min\.js/g)).toHaveLength(2)
  })

  it('forces network-capable CSP for HTMX runtimes even when artifact network is disabled', () => {
    const document = buildHtmlArtifactPreviewDocument({
      source: '<button hx-get="/clicked">Click Me</button>',
      title: 'HTMX Network Policy',
      runtimeProfileId: 'html+htmx',
      settings: getDefaultArtifactSettings(),
      overrides: {
        internetEnabled: false
      }
    })

    expect(document).toContain('default-src * data: blob: filesystem:')
    expect(document).toContain('connect-src * data: blob:')
    expect(document).not.toContain("connect-src 'none'")
  })
})
