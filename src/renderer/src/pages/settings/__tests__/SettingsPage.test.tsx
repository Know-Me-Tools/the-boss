import store from '@renderer/store'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18Next from 'react-i18next'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import SettingsPage from '../SettingsPage'

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  NavbarCenter: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('../ContextManagementSettings/ContextManagementSettings', () => ({
  default: () => <div>Context management page</div>
}))

vi.mock('../SkillSettings', () => ({
  default: () => <div>Skill configuration page</div>
}))

vi.mock('../AboutSettings', () => ({ default: () => <div>About settings</div> }))
vi.mock('../ChannelsSettings', () => ({ default: () => <div>Channels settings</div> }))
vi.mock('../DataSettings/DataSettings', () => ({ default: () => <div>Data settings</div> }))
vi.mock('../DisplaySettings/DisplaySettings', () => ({ default: () => <div>Display settings</div> }))
vi.mock('../DocProcessSettings', () => ({ default: () => <div>Doc process settings</div> }))
vi.mock('../GeneralSettings', () => ({ default: () => <div>General settings</div> }))
vi.mock('../MCPSettings', () => ({ default: () => <div>MCP settings</div> }))
vi.mock('../MemorySettings', () => ({ default: () => <div>Memory settings</div> }))
vi.mock('../ProviderSettings', () => ({ ProviderList: () => <div>Provider list</div> }))
vi.mock('../QuickAssistantSettings', () => ({ default: () => <div>Quick assistant settings</div> }))
vi.mock('../QuickPhraseSettings', () => ({ default: () => <div>Quick phrase settings</div> }))
vi.mock('../SelectionAssistantSettings/SelectionAssistantSettings', () => ({
  default: () => <div>Selection assistant settings</div>
}))
vi.mock('../ShortcutSettings', () => ({ default: () => <div>Shortcut settings</div> }))
vi.mock('../SkillsSettings', () => ({ default: () => <div>Skills settings</div> }))
vi.mock('../TasksSettings', () => ({ default: () => <div>Tasks settings</div> }))
vi.mock('../ToolSettings/ApiServerSettings', () => ({ ApiServerSettings: () => <div>API server settings</div> }))
vi.mock('../WebSearchSettings', () => ({ default: () => <div>Web search settings</div> }))
vi.mock('@renderer/pages/settings/ArtifactSettings', () => ({ default: () => <div>Artifact settings</div> }))
vi.mock('@renderer/pages/settings/ModelSettings/ModelSettings', () => ({ default: () => <div>Model settings</div> }))
vi.mock('@renderer/pages/settings/ServicesSettings', () => ({ default: () => <div>Services settings</div> }))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ReactI18Next
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string }) =>
        options?.defaultValue ??
        {
          'settings.title': 'Settings',
          'settings.provider.title': 'Model Provider',
          'settings.model': 'Default Model',
          'settings.general.label': 'General Settings',
          'settings.display.title': 'Display Settings',
          'settings.data.title': 'Data Settings',
          'settings.artifacts.title': 'Artifacts',
          'settings.mcp.title': 'MCP Servers',
          'settings.skills.title': 'Skills',
          'settings.skill.title': 'Skill Configuration',
          'settings.contextStrategy.title': 'Context Management',
          'settings.tool.websearch.title': 'Web Search',
          'memory.title': 'Memories',
          'apiServer.title': 'API Server',
          'settings.channels.title': 'Channels',
          'settings.scheduledTasks.title': 'Scheduled Tasks',
          'settings.tool.preprocess.title': 'Document Processing',
          'settings.quickPhrase.title': 'Quick Phrases',
          'settings.shortcuts.title': 'Keyboard Shortcuts',
          'settings.quickAssistant.title': 'Quick Assistant',
          'selection.name': 'Selection',
          'settings.about.label': 'About'
        }[key] ??
        key
    })
  }
})

describe('SettingsPage', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    })

    ;(window as any).api = {
      ...(window as any).api,
      getAppInfo: vi.fn().mockResolvedValue({
        appPath: '/tmp',
        homePath: '/tmp'
      })
    }
  })

  it('shows a dedicated Context Management navigation item', () => {
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/settings/skill']}>
          <Routes>
            <Route path="/settings/*" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    )

    expect(screen.getByText('Skill Configuration')).toBeInTheDocument()
    expect(screen.getByText('Context Management')).toBeInTheDocument()
  })

  it('renders the standalone Context Management route', () => {
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/settings/context-management']}>
          <Routes>
            <Route path="/settings/*" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    )

    expect(screen.getByText('Context management page')).toBeInTheDocument()
  })
})
