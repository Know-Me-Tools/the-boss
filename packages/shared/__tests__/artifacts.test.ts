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

  it('treats htmx as an HTML artifact alias', () => {
    expect(
      parseArtifactLanguage(
        'htmx',
        {
          defaultHtmlRuntimeProfileId: 'html',
          defaultReactRuntimeProfileId: 'react-default'
        },
        '<div hx-get="/api/feedback"></div>'
      )
    ).toMatchObject({
      kind: 'html',
      runtimeProfileId: 'html+htmx',
      editorLanguage: 'html',
      sourceLanguage: 'html'
    })
  })

  it('promotes plain html with htmx markers into the htmx runtime', () => {
    expect(
      parseArtifactLanguage(
        'html',
        {
          defaultHtmlRuntimeProfileId: 'html',
          defaultReactRuntimeProfileId: 'react-default'
        },
        '<div hx-target="#content" hx-swap="innerHTML"></div>'
      )
    ).toMatchObject({
      kind: 'html',
      runtimeProfileId: 'html+htmx'
    })
  })

  it('promotes plain html with both htmx and alpine markers into the combined runtime', () => {
    expect(
      parseArtifactLanguage(
        'html',
        {
          defaultHtmlRuntimeProfileId: 'html',
          defaultReactRuntimeProfileId: 'react-default'
        },
        '<div x-data="{ open: false }" hx-get="/api/feedback"></div>'
      )
    ).toMatchObject({
      kind: 'html',
      runtimeProfileId: 'html+htmx+alpine'
    })
  })
})
