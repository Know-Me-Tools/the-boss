import { CheckOutlined, PlusOutlined } from '@ant-design/icons'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { getBuiltInMcpServerDescriptionLabel, getMcpTypeLabel } from '@renderer/i18n/label'
import { builtinMCPServers } from '@renderer/store/mcp'
import { Button, Popover } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'

import { SettingTitle } from '..'

type BadgeTone = 'default' | 'info' | 'success' | 'warning'

const getBadgeToneStyles = (tone: BadgeTone) => {
  switch (tone) {
    case 'info':
      return css`
        color: #93c5fd;
        background: rgba(37, 99, 235, 0.18);
        border-color: rgba(96, 165, 250, 0.38);

        [theme-mode='light'] & {
          color: #1d4ed8;
          background: #eff6ff;
          border-color: #bfdbfe;
        }
      `
    case 'success':
      return css`
        color: #86efac;
        background: rgba(34, 197, 94, 0.18);
        border-color: rgba(74, 222, 128, 0.38);

        [theme-mode='light'] & {
          color: #15803d;
          background: #f0fdf4;
          border-color: #86efac;
        }
      `
    case 'warning':
      return css`
        color: #fcd34d;
        background: rgba(245, 158, 11, 0.18);
        border-color: rgba(251, 191, 36, 0.38);

        [theme-mode='light'] & {
          color: #b45309;
          background: #fffbeb;
          border-color: #fcd34d;
        }
      `
    default:
      return css`
        color: var(--color-text-2);
        background: var(--color-background-mute);
        border-color: var(--color-border);
      `
  }
}

const BuiltinMCPServerList: FC = () => {
  const { t } = useTranslation()
  const { addMCPServer, mcpServers } = useMCPServers()

  return (
    <>
      <SettingTitle style={{ gap: 3, marginBottom: 10 }}>{t('settings.mcp.builtinServers')}</SettingTitle>
      <ServersGrid>
        {builtinMCPServers.map((server) => {
          const isInstalled = mcpServers.some((existingServer) => existingServer.name === server.name)

          return (
            <ServerCard key={server.id}>
              <ServerHeader>
                <ServerName>
                  <ServerNameText>{server.name}</ServerNameText>
                </ServerName>
                <StatusIndicator>
                  <Button
                    type="text"
                    icon={isInstalled ? <CheckOutlined style={{ color: 'var(--color-primary)' }} /> : <PlusOutlined />}
                    size="small"
                    onClick={() => {
                      if (isInstalled) {
                        return
                      }

                      addMCPServer(server)
                      window.toast.success(t('settings.mcp.addSuccess'))
                    }}
                    disabled={isInstalled}
                  />
                </StatusIndicator>
              </ServerHeader>
              <Popover
                content={
                  <PopoverContent>
                    {getBuiltInMcpServerDescriptionLabel(server.name)}
                    {server.reference && <ReferenceLink href={server.reference}>{server.reference}</ReferenceLink>}
                  </PopoverContent>
                }
                title={server.name}
                trigger="hover"
                placement="topLeft"
                overlayStyle={{ maxWidth: 400 }}>
                <ServerDescription>{getBuiltInMcpServerDescriptionLabel(server.name)}</ServerDescription>
              </Popover>
              <ServerFooter>
                <ServerTag $tone="info">{getMcpTypeLabel(server.type ?? 'stdio')}</ServerTag>
                {server?.shouldConfig && (
                  <a
                    href="https://the-boss.know-me.tools/docs/advanced-basic/mcp/buildin"
                    target="_blank"
                    rel="noopener noreferrer">
                    <ServerTag $tone="warning">{t('settings.mcp.requiresConfig')}</ServerTag>
                  </a>
                )}
              </ServerFooter>
            </ServerCard>
          )
        })}
      </ServersGrid>
    </>
  )
}

const ServersGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
`

const ServerCard = styled.div`
  display: flex;
  flex-direction: column;
  border: 0.5px solid var(--color-border);
  border-radius: var(--list-item-border-radius);
  padding: 10px 16px;
  transition: all 0.2s ease;
  background-color: var(--color-background);
  height: 125px;
  cursor: default;

  &:hover {
    border-color: var(--color-primary);
  }
`

const ServerHeader = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 5px;
`

const ServerName = styled.div`
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 4px;
`

const ServerNameText = styled.span`
  font-size: 15px;
  font-weight: 500;
`

const StatusIndicator = styled.div`
  margin-left: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
`

const ServerDescription = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  width: 100%;
  word-break: break-word;
  max-height: calc(1.4em * 2);
  cursor: pointer;
  position: relative;

  &:hover {
    color: var(--color-text-1);
  }
`

const PopoverContent = styled.div`
  max-width: 350px;
  line-height: 1.5;
  font-size: 14px;
  color: var(--color-text-1);
  white-space: pre-wrap;
  word-break: break-word;
`

const ReferenceLink = styled.a`
  max-width: 350px;
  white-space: normal;
  color: var(--color-primary);
  text-decoration: none;
  word-break: break-word;
  line-height: 1.4;
  display: inline-block;
  margin-top: 8px;

  &:hover {
    color: var(--color-primary-hover);
    text-decoration: underline;
  }
`

const ServerFooter = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-start;
  margin-top: 10px;
`

const ServerTag = styled.span<{ $tone: BadgeTone }>`
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 20px;
  margin: 0;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
  ${({ $tone }) => getBadgeToneStyles($tone)}
`

export default BuiltinMCPServerList
