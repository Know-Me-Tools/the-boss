import type { MinAppType } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import MinApp from '../MinApp'

const mocks = vi.hoisted(() => ({
  openMinappKeepAlive: vi.fn(),
  updateMinapps: vi.fn(),
  updateDisabledMinApps: vi.fn(),
  updatePinnedMinApps: vi.fn()
}))

vi.mock('@renderer/components/Icons/MinAppIcon', () => ({
  default: ({ app }: { app: MinAppType }) => <div data-testid="minapp-icon">{app.name}</div>
}))

vi.mock('@renderer/components/IndicatorLight', () => ({
  default: () => <div data-testid="indicator-light" />
}))

vi.mock('@renderer/components/MarqueeText', () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

vi.mock('@renderer/hooks/useMinappPopup', () => ({
  useMinappPopup: () => ({
    openMinappKeepAlive: mocks.openMinappKeepAlive
  })
}))

vi.mock('@renderer/hooks/useMinapps', () => ({
  useMinapps: () => ({
    minapps: [{ id: 'artifacts' }],
    pinned: [],
    disabled: [],
    updateMinapps: mocks.updateMinapps,
    updateDisabledMinapps: mocks.updateDisabledMinApps,
    updatePinnedMinapps: mocks.updatePinnedMinApps
  })
}))

vi.mock('@renderer/hooks/useRuntime', () => ({
  useRuntime: () => ({
    openedKeepAliveMinapps: [],
    currentMinappId: '',
    minappShow: false
  })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useNavbarPosition: () => ({
    isTopNavbar: false
  })
}))

vi.mock('@renderer/store/runtime', () => ({
  setOpenedKeepAliveMinapps: vi.fn()
}))

vi.mock('react-redux', () => ({
  useDispatch: () => vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'minapps.artifacts' ? 'Artifacts' : key)
  })
}))

describe('MinApp route-backed apps', () => {
  it('navigates to the internal route instead of opening a webview popup', () => {
    const app: MinAppType = {
      id: 'artifacts',
      name: 'Artifacts',
      nameKey: 'minapps.artifacts',
      url: '/artifacts',
      route: '/artifacts'
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MinApp app={app} />} />
          <Route path="/artifacts" element={<div>Artifact library route</div>} />
        </Routes>
      </MemoryRouter>
    )

    fireEvent.click(screen.getAllByText('Artifacts')[0])

    expect(screen.getByText('Artifact library route')).toBeInTheDocument()
    expect(mocks.openMinappKeepAlive).not.toHaveBeenCalled()
  })
})
