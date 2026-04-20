import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    error: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mockLogger
  }
}))

vi.mock('../index', () => ({
  default: {
    t: (key: string) => (key === 'provider.theboss' ? 'The Boss' : key)
  }
}))

const { getProviderLabel } = await import('../label')

describe('i18n labels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the built-in The Boss provider label without logging a missing key', () => {
    expect(getProviderLabel('theboss')).toBe('The Boss')
    expect(mockLogger.error).not.toHaveBeenCalled()
  })
})
