import { useTheme } from '@renderer/context/ThemeProvider'
import { useArtifactSettings } from '@renderer/hooks/useArtifactSettings'
import { useServices } from '@renderer/hooks/useServices'
import type {
  ArtifactPackageRegistryEntry,
  ArtifactThemePreset,
  HtmlArtifactRuntimeProfile,
  ReactArtifactRuntimeProfile
} from '@shared/artifacts'
import type { ServiceToolSummary } from '@shared/services'
import { Button, Select, Space, Switch, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import {
  SettingContainer,
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '..'
import ArtifactLibrarySection from './ArtifactLibrarySection'

type RuntimeProfilesPayload = {
  html: HtmlArtifactRuntimeProfile[]
  react: ReactArtifactRuntimeProfile[]
}

const ArtifactSettings = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { settings, loading, updateSettings } = useArtifactSettings()
  const { services, loading: servicesLoading } = useServices()
  const [runtimeProfiles, setRuntimeProfiles] = useState<RuntimeProfilesPayload>({ html: [], react: [] })
  const [themes, setThemes] = useState<ArtifactThemePreset[]>([])
  const [registry, setRegistry] = useState<ArtifactPackageRegistryEntry[]>([])
  const [serviceTools, setServiceTools] = useState<ServiceToolSummary[]>([])
  const [serviceToolsLoading, setServiceToolsLoading] = useState(true)

  useEffect(() => {
    void Promise.all([
      window.api.artifacts.getRuntimeProfiles(),
      window.api.artifacts.getThemes(),
      window.api.artifacts.getPackageRegistry()
    ]).then(([profiles, themePresets, packageRegistry]) => {
      setRuntimeProfiles(profiles)
      setThemes(themePresets)
      setRegistry(packageRegistry)
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    void window.api.services
      .listProjectedTools()
      .then((tools) => {
        if (!cancelled) {
          setServiceTools(tools)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setServiceToolsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const groupedServiceTools = useMemo(() => {
    return serviceTools.reduce<Record<string, ServiceToolSummary[]>>((groups, tool) => {
      groups[tool.serviceName] = [...(groups[tool.serviceName] ?? []), tool]
      return groups
    }, {})
  }, [serviceTools])

  const packageColumns = useMemo<ColumnsType<ArtifactPackageRegistryEntry>>(
    () => [
      {
        title: t('settings.artifacts.package_name'),
        dataIndex: 'packageName',
        key: 'packageName'
      },
      {
        title: t('settings.artifacts.package_kind'),
        dataIndex: 'kind',
        key: 'kind',
        render: (value) => <Tag>{value}</Tag>
      },
      {
        title: t('settings.artifacts.package_version'),
        dataIndex: 'version',
        key: 'version'
      },
      {
        title: t('settings.artifacts.package_runtime'),
        dataIndex: 'runtimeKinds',
        key: 'runtimeKinds',
        render: (value: string[]) => value.map((entry) => <Tag key={entry}>{entry}</Tag>)
      }
    ],
    [t]
  )

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.artifacts.title')}</SettingTitle>
        <SettingDescription>{t('settings.artifacts.description')}</SettingDescription>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.artifacts.default_html_runtime')}</SettingRowTitle>
          <Select
            value={settings.defaultHtmlRuntimeProfileId}
            style={{ width: 280 }}
            loading={loading}
            options={runtimeProfiles.html.map((profile) => ({
              label: profile.label,
              value: profile.id
            }))}
            onChange={(value) =>
              void updateSettings((prev) => ({
                ...prev,
                defaultHtmlRuntimeProfileId: value
              }))
            }
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.artifacts.default_react_runtime')}</SettingRowTitle>
          <Select
            value={settings.defaultReactRuntimeProfileId}
            style={{ width: 280 }}
            loading={loading}
            options={runtimeProfiles.react.map((profile) => ({
              label: profile.label,
              value: profile.id
            }))}
            onChange={(value) =>
              void updateSettings((prev) => ({
                ...prev,
                defaultReactRuntimeProfileId: value
              }))
            }
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.artifacts.default_theme')}</SettingRowTitle>
          <Select
            value={settings.defaultThemeId}
            style={{ width: 280 }}
            loading={loading}
            options={themes.map((preset) => ({
              label: preset.label,
              value: preset.id
            }))}
            onChange={(value) =>
              void updateSettings((prev) => ({
                ...prev,
                defaultThemeId: value
              }))
            }
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.artifacts.internet_default')}</SettingRowTitle>
          <Switch
            checked={settings.accessPolicy.internetEnabled}
            onChange={(checked) =>
              void updateSettings((prev) => ({
                ...prev,
                accessPolicy: {
                  ...prev.accessPolicy,
                  internetEnabled: checked
                }
              }))
            }
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.artifacts.show_package_registry')}</SettingRowTitle>
          <Switch
            checked={settings.exposePackageRegistry}
            onChange={(checked) =>
              void updateSettings((prev) => ({
                ...prev,
                exposePackageRegistry: checked
              }))
            }
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.artifacts.styling_title')}</SettingTitle>
        <SettingDescription>{t('settings.artifacts.styling_description')}</SettingDescription>
        <SettingDivider />
        <SettingRowTitle style={{ marginBottom: 8 }}>{t('settings.artifacts.base_css')}</SettingRowTitle>
        <TextArea
          value={settings.baseCss}
          rows={12}
          onChange={(event) =>
            void updateSettings((prev) => ({
              ...prev,
              baseCss: event.target.value
            }))
          }
        />
        <SettingDivider />
        <SettingRowTitle style={{ marginBottom: 8 }}>{t('settings.artifacts.custom_css')}</SettingRowTitle>
        <TextArea
          value={settings.customCss}
          rows={10}
          onChange={(event) =>
            void updateSettings((prev) => ({
              ...prev,
              customCss: event.target.value
            }))
          }
        />
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>
          <span>Shared Service Access</span>
          <Link to="/settings/services">
            <Button icon={<ExternalLink size={14} />} size="small" type="primary">
              Open Services
            </Button>
          </Link>
        </SettingTitle>
        <SettingDescription>
          Artifacts can still allow full service access for legacy operation calls and subscriptions, but projected
          service tools are the preferred default for scoped runtime access.
        </SettingDescription>
        <SettingDivider />
        <SectionHeading>Legacy Service Access</SectionHeading>
        {servicesLoading ? (
          <SettingDescription>Loading shared services...</SettingDescription>
        ) : services.length === 0 ? (
          <SettingDescription>No shared services are registered yet.</SettingDescription>
        ) : (
          services.map((service) => {
            const isEnabled = settings.accessPolicy.serviceIds.includes(service.serviceId)
            const projectedCount = service.projectedTools.filter((tool) => tool.enabled).length

            return (
              <ServiceRow key={service.serviceId}>
                <div>
                  <ServiceTitle>{service.name}</ServiceTitle>
                  <ServiceMeta>
                    <Tag>{service.kind}</Tag>
                    <span>{service.endpoint}</span>
                    <span>{projectedCount} projected tools</span>
                  </ServiceMeta>
                </div>
                <Space>
                  <Switch
                    checked={isEnabled}
                    checkedChildren="Allowed"
                    unCheckedChildren="Blocked"
                    onChange={(checked) =>
                      void updateSettings((prev) => ({
                        ...prev,
                        accessPolicy: {
                          ...prev.accessPolicy,
                          serviceIds: checked
                            ? Array.from(new Set([...prev.accessPolicy.serviceIds, service.serviceId]))
                            : prev.accessPolicy.serviceIds.filter((id) => id !== service.serviceId)
                        }
                      }))
                    }
                  />
                </Space>
              </ServiceRow>
            )
          })
        )}
        <SettingDivider />
        <SectionHeading>Projected Service Tools</SectionHeading>
        <SettingDescription>
          Allow the specific shared tools that HTML and React artifacts may call through
          `artifactServices.invokeTool(...)`.
        </SettingDescription>
        {serviceToolsLoading ? (
          <SettingDescription>Loading shared service tools...</SettingDescription>
        ) : serviceTools.length === 0 ? (
          <SettingDescription>No projected shared service tools are available yet.</SettingDescription>
        ) : (
          Object.entries(groupedServiceTools).map(([serviceName, tools]) => (
            <ServiceToolGroup key={serviceName}>
              <ServiceToolGroupTitle>{serviceName}</ServiceToolGroupTitle>
              {tools.map((tool) => {
                const isEnabled = settings.accessPolicy.serviceToolIds.includes(tool.id)

                return (
                  <ServiceRow key={tool.id}>
                    <div>
                      <ServiceTitle>{tool.name}</ServiceTitle>
                      <ServiceMeta>
                        <Tag color="processing">{tool.serviceKind}</Tag>
                        <Tag>{tool.projectionKind}</Tag>
                        {tool.description ? <span>{tool.description}</span> : null}
                      </ServiceMeta>
                    </div>
                    <Space>
                      <Switch
                        checked={isEnabled}
                        checkedChildren="Allowed"
                        unCheckedChildren="Blocked"
                        onChange={(checked) =>
                          void updateSettings((prev) => ({
                            ...prev,
                            accessPolicy: {
                              ...prev.accessPolicy,
                              serviceToolIds: checked
                                ? Array.from(new Set([...prev.accessPolicy.serviceToolIds, tool.id]))
                                : prev.accessPolicy.serviceToolIds.filter((id) => id !== tool.id)
                            }
                          }))
                        }
                      />
                    </Space>
                  </ServiceRow>
                )
              })}
            </ServiceToolGroup>
          ))
        )}
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.artifacts.package_registry_title')}</SettingTitle>
        <SettingDescription>{t('settings.artifacts.package_registry_description')}</SettingDescription>
        <SettingDivider />
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          columns={packageColumns}
          dataSource={registry}
          scroll={{ x: 720 }}
        />
      </SettingGroup>

      <ArtifactLibrarySection theme={theme} settings={settings} />
    </SettingContainer>
  )
}

const TextArea = styled.textarea`
  width: 100%;
  min-height: 160px;
  resize: vertical;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
  color: var(--color-text-1);
  padding: 12px;
  font: inherit;
`

const SectionHeading = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
  margin-bottom: 12px;
`

const ServiceRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
`

const ServiceTitle = styled.div`
  font-weight: 600;
  color: var(--color-text-1);
`

const ServiceMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-3);
  font-size: 12px;
  margin-top: 6px;
  flex-wrap: wrap;
`

const ServiceToolGroup = styled.div`
  display: flex;
  flex-direction: column;
`

const ServiceToolGroupTitle = styled.div`
  margin: 16px 0 8px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--color-text-3);
`

export default ArtifactSettings
