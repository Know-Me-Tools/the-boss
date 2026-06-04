import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ArtifactsPage from '../ArtifactsPage'

const mocks = vi.hoisted(() => ({
  settings: {
    defaultHtmlRuntimeProfileId: 'html+htmx',
    defaultReactRuntimeProfileId: 'react+vite'
  }
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'dark' })
}))

vi.mock('@renderer/hooks/useArtifactSettings', () => ({
  useArtifactSettings: () => ({
    settings: mocks.settings,
    loading: false
  })
}))

vi.mock('@renderer/pages/settings/ArtifactSettings/ArtifactLibrarySection', () => ({
  default: ({ theme, settings }: { theme: string; settings: typeof mocks.settings }) => (
    <div data-testid="artifact-library-section">
      {theme}:{settings.defaultHtmlRuntimeProfileId}
    </div>
  )
}))

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  NavbarCenter: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'title.artifacts' ? 'Artifacts' : key)
  })
}))

describe('ArtifactsPage', () => {
  it('renders the route page and reuses the stored artifact library section', () => {
    render(<ArtifactsPage />)

    expect(screen.getByText('Artifacts')).toBeInTheDocument()
    expect(screen.getByTestId('artifact-library-section')).toHaveTextContent('dark:html+htmx')
  })
})
