import { describe, expect, it } from 'vitest'

import { parseArtifactLanguage } from '../artifacts'

describe('parseArtifactLanguage', () => {
  it('treats TSX-oriented aliases as React artifact inputs', () => {
    expect(
      parseArtifactLanguage('tsx-artifact', {
        defaultHtmlRuntimeProfileId: 'html',
        defaultReactRuntimeProfileId: 'react-default'
      })
    ).toMatchObject({
      kind: 'react',
      editorLanguage: 'tsx',
      sourceLanguage: 'tsx',
      displayType: 'React/TSX Artifact'
    })
  })

  it('keeps jsx-artifact as a compatibility alias', () => {
    expect(
      parseArtifactLanguage('jsx-artifact', {
        defaultHtmlRuntimeProfileId: 'html',
        defaultReactRuntimeProfileId: 'react-default'
      })
    ).toMatchObject({
      kind: 'react',
      editorLanguage: 'tsx',
      sourceLanguage: 'jsx'
    })
  })
})
