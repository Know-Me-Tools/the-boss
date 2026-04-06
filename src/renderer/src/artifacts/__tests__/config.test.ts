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
})
