import { afterEach, describe, expect, it, vi } from 'vitest'

import { searchSkills } from '../SkillSearchService'

describe('searchSkills', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('skips remote registry requests for single-character queries', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const results = await searchSkills('r')

    expect(results).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
