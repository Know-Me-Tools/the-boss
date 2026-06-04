import { backfillArtifactsSidebarIcon, DEFAULT_SIDEBAR_ICONS } from '@renderer/config/sidebar'
import { describe, expect, it } from 'vitest'

describe('sidebar config', () => {
  it('includes artifacts in default sidebar icons', () => {
    expect(DEFAULT_SIDEBAR_ICONS).toContain('artifacts')
  })

  it('backfills artifacts after minapp without resetting existing preferences', () => {
    const sidebarIcons = {
      visible: ['assistants', 'minapp', 'files'],
      disabled: ['notes']
    }

    backfillArtifactsSidebarIcon(sidebarIcons)

    expect(sidebarIcons.visible).toEqual(['assistants', 'minapp', 'artifacts', 'files'])
    expect(sidebarIcons.disabled).toEqual(['notes'])
  })

  it('does not duplicate artifacts when already disabled', () => {
    const sidebarIcons = {
      visible: ['assistants', 'minapp', 'files'],
      disabled: ['artifacts']
    }

    backfillArtifactsSidebarIcon(sidebarIcons)

    expect(sidebarIcons.visible).toEqual(['assistants', 'minapp', 'files'])
    expect(sidebarIcons.disabled).toEqual(['artifacts'])
  })
})
