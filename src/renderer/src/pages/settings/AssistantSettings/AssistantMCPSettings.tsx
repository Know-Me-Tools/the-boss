import { InfoCircleOutlined } from '@ant-design/icons'
import { Box } from '@renderer/components/Layout'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { Assistant, AssistantSettings, McpMode } from '@renderer/types'
import { getEffectiveMcpMode } from '@renderer/types'
import type { ServiceToolSummary } from '@shared/services'
import { Empty, Radio, Switch, Tag, Tooltip } from 'antd'
import { uniq } from 'lodash'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

export interface MCPServer {
  id: string
  name: string
  description?: string
  baseUrl?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  isActive: boolean
}

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings: (settings: AssistantSettings) => void
}

const AssistantMCPSettings: React.FC<Props> = ({ assistant, updateAssistant }) => {
  const { t } = useTranslation()
  const { mcpServers: allMcpServers } = useMCPServers()
  const [serviceTools, setServiceTools] = useState<ServiceToolSummary[]>([])

  const currentMode = getEffectiveMcpMode(assistant)
  const selectedServiceToolIds = assistant.serviceToolIds ?? []

  useEffect(() => {
    let cancelled = false

    void window.api.services
      .listProjectedTools()
      .then((tools) => {
        if (!cancelled) {
          setServiceTools(tools)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setServiceTools([])
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

  const handleModeChange = (mode: McpMode) => {
    updateAssistant({ ...assistant, mcpMode: mode })
  }

  const onUpdate = (ids: string[]) => {
    const mcpServers = ids
      .map((id) => allMcpServers.find((server) => server.id === id))
      .filter((server): server is MCPServer => server !== undefined && server.isActive)

    updateAssistant({ ...assistant, mcpServers, mcpMode: 'manual' })
  }

  const handleServerToggle = (serverId: string) => {
    const currentServerIds = assistant.mcpServers?.map((server) => server.id) || []

    if (currentServerIds.includes(serverId)) {
      onUpdate(currentServerIds.filter((id) => id !== serverId))
    } else {
      onUpdate([...currentServerIds, serverId])
    }
  }

  const handleServiceToolToggle = (toolId: string) => {
    const nextIds = selectedServiceToolIds.includes(toolId)
      ? selectedServiceToolIds.filter((id) => id !== toolId)
      : uniq([...selectedServiceToolIds, toolId])

    updateAssistant({ ...assistant, serviceToolIds: nextIds })
  }

  const enabledCount = assistant.mcpServers?.length || 0

  return (
    <Container>
      <HeaderContainer>
        <Box style={{ fontWeight: 'bold', fontSize: '14px' }}>
          {t('assistants.settings.mcp.title')}
          <Tooltip title={t('assistants.settings.mcp.description', 'Select MCP servers to use with this assistant')}>
            <InfoIcon />
          </Tooltip>
        </Box>
      </HeaderContainer>

      <ModeSelector>
        <Radio.Group value={currentMode} onChange={(e) => handleModeChange(e.target.value)}>
          <Radio.Button value="disabled">
            <ModeOption>
              <ModeLabel>{t('assistants.settings.mcp.mode.disabled.label')}</ModeLabel>
              <ModeDescription>{t('assistants.settings.mcp.mode.disabled.description')}</ModeDescription>
            </ModeOption>
          </Radio.Button>
          <Radio.Button value="auto">
            <ModeOption>
              <ModeLabel>{t('assistants.settings.mcp.mode.auto.label')}</ModeLabel>
              <ModeDescription>{t('assistants.settings.mcp.mode.auto.description')}</ModeDescription>
            </ModeOption>
          </Radio.Button>
          <Radio.Button value="manual">
            <ModeOption>
              <ModeLabel>{t('assistants.settings.mcp.mode.manual.label')}</ModeLabel>
              <ModeDescription>{t('assistants.settings.mcp.mode.manual.description')}</ModeDescription>
            </ModeOption>
          </Radio.Button>
        </Radio.Group>
      </ModeSelector>

      {currentMode === 'manual' && (
        <>
          {allMcpServers.length > 0 && (
            <EnabledCount>
              {enabledCount} / {allMcpServers.length} {t('settings.mcp.active')}
            </EnabledCount>
          )}

          {allMcpServers.length > 0 ? (
            <ServerList>
              {allMcpServers.map((server) => {
                const isEnabled = assistant.mcpServers?.some((s) => s.id === server.id) || false

                return (
                  <ServerItem key={server.id} isEnabled={isEnabled}>
                    <ServerInfo>
                      <ServerName>{server.name}</ServerName>
                      {server.description && <ServerDescription>{server.description}</ServerDescription>}
                      {server.baseUrl && <ServerUrl>{server.baseUrl}</ServerUrl>}
                    </ServerInfo>
                    <Tooltip
                      title={
                        !server.isActive
                          ? t('assistants.settings.mcp.enableFirst', 'Enable this server in MCP settings first')
                          : undefined
                      }>
                      <Switch
                        checked={isEnabled}
                        disabled={!server.isActive}
                        onChange={() => handleServerToggle(server.id)}
                        size="small"
                      />
                    </Tooltip>
                  </ServerItem>
                )
              })}
            </ServerList>
          ) : (
            <EmptyContainer>
              <Empty
                description={t('assistants.settings.mcp.noServersAvailable', 'No MCP servers available')}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </EmptyContainer>
          )}
        </>
      )}

      <SectionDivider />

      <HeaderContainer>
        <Box style={{ fontWeight: 'bold', fontSize: '14px' }}>
          {t('assistants.settings.mcp.serviceToolsTitle', 'Service Tools')}
          <Tooltip
            title={t(
              'assistants.settings.mcp.serviceToolsDescription',
              'Explicitly allow projected shared-service tools for this assistant.'
            )}>
            <InfoIcon />
          </Tooltip>
        </Box>
      </HeaderContainer>

      {serviceTools.length === 0 ? (
        <EmptyContainer>
          <Empty
            description={t('assistants.settings.mcp.noServiceTools', 'No shared service tools available')}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </EmptyContainer>
      ) : (
        <ServiceToolList>
          {Object.entries(groupedServiceTools).map(([serviceName, tools]) => (
            <ServiceToolGroup key={serviceName}>
              <ServiceToolGroupTitle>{serviceName}</ServiceToolGroupTitle>
              {tools.map((tool) => {
                const isEnabled = selectedServiceToolIds.includes(tool.id)

                return (
                  <ServerItem key={tool.id} isEnabled={isEnabled}>
                    <ServerInfo>
                      <ServerName>{tool.name}</ServerName>
                      {tool.description ? <ServerDescription>{tool.description}</ServerDescription> : null}
                      <ServiceToolMeta>
                        <Tag color="processing">{tool.serviceKind}</Tag>
                        <Tag>{tool.projectionKind}</Tag>
                      </ServiceToolMeta>
                    </ServerInfo>
                    <Switch checked={isEnabled} onChange={() => handleServiceToolToggle(tool.id)} size="small" />
                  </ServerItem>
                )
              })}
            </ServiceToolGroup>
          ))}
        </ServiceToolList>
      )}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
`

const HeaderContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`

const InfoIcon = styled(InfoCircleOutlined)`
  margin-left: 6px;
  font-size: 14px;
  color: var(--color-text-2);
  cursor: help;
`

const ModeSelector = styled.div`
  margin-bottom: 16px;

  .ant-radio-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ant-radio-button-wrapper {
    height: auto;
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid var(--color-border);

    &:not(:first-child)::before {
      display: none;
    }

    &:first-child {
      border-radius: 8px;
    }

    &:last-child {
      border-radius: 8px;
    }
  }
`

const ModeOption = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const ModeLabel = styled.span`
  font-weight: 600;
`

const ModeDescription = styled.span`
  font-size: 12px;
  color: var(--color-text-2);
`

const EnabledCount = styled.span`
  font-size: 12px;
  color: var(--color-text-2);
  margin-bottom: 8px;
`

const EmptyContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 40px 0;
`

const SectionDivider = styled.div`
  margin: 16px 0;
  border-top: 1px solid var(--color-border);
`

const ServerList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
`

const ServiceToolList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const ServiceToolGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ServiceToolGroupTitle = styled.div`
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-3);
`

const ServerItem = styled.div<{ isEnabled: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-radius: 8px;
  background-color: var(--color-background-mute);
  border: 1px solid var(--color-border);
  transition: all 0.2s ease;
  opacity: ${(props) => (props.isEnabled ? 1 : 0.7)};
`

const ServerInfo = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
`

const ServerName = styled.div`
  font-weight: 600;
  margin-bottom: 4px;
`

const ServerDescription = styled.div`
  font-size: 0.85rem;
  color: var(--color-text-2);
  margin-bottom: 3px;
`

const ServiceToolMeta = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`

const ServerUrl = styled.div`
  font-size: 0.8rem;
  color: var(--color-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

export default AssistantMCPSettings
