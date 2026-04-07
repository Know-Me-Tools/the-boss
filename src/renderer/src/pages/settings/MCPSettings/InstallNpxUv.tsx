import { CheckCircleOutlined, QuestionCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { Center, VStack } from '@renderer/components/Layout'
import type { DependencyStatus } from '@shared/config/types'
import { Alert, Button } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import styled from 'styled-components'

import { SettingDescription, SettingRow, SettingSubtitle } from '..'

interface Props {
  mini?: boolean
}

function getDependencyLabel(name: 'uv' | 'bun', status: DependencyStatus | null): string {
  if (!status || status.source === 'missing') {
    return `${name.toUpperCase()} is Missing, please install it to continue.`
  }

  if (status.source === 'environment') {
    return `${name.toUpperCase()} is available from environment.`
  }

  return `${name.toUpperCase()} is installed by The Boss.`
}

const InstallNpxUv: FC<Props> = ({ mini = false }) => {
  const [isInstallingUv, setIsInstallingUv] = useState(false)
  const [isInstallingBun, setIsInstallingBun] = useState(false)
  const [uvStatus, setUvStatus] = useState<DependencyStatus | null>(null)
  const [bunStatus, setBunStatus] = useState<DependencyStatus | null>(null)
  const { t } = useTranslation()
  const navigate = useNavigate()

  const checkBinaries = useCallback(async () => {
    const [nextUvStatus, nextBunStatus] = await window.api.dependencies.getStatuses(['uv', 'bun'])
    setUvStatus(nextUvStatus)
    setBunStatus(nextBunStatus)
  }, [])

  const installUV = async () => {
    try {
      setIsInstallingUv(true)
      await window.api.installUVBinary()
      window.toast.success(t('settings.mcp.installSuccess'))
    } catch (error: any) {
      window.toast.error(`${t('settings.mcp.installError')}: ${error.message}`)
    } finally {
      setIsInstallingUv(false)
      await checkBinaries()
    }
  }

  const installBun = async () => {
    try {
      setIsInstallingBun(true)
      await window.api.installBunBinary()
      window.toast.success(t('settings.mcp.installSuccess'))
    } catch (error: any) {
      window.toast.error(`${t('settings.mcp.installError')}: ${error.message}`)
    } finally {
      setIsInstallingBun(false)
      await checkBinaries()
    }
  }

  useEffect(() => {
    void checkBinaries()
  }, [checkBinaries])

  if (mini) {
    const installed = (uvStatus?.available ?? false) && (bunStatus?.available ?? false)
    return (
      <Button
        type="primary"
        variant="filled"
        shape="circle"
        icon={installed ? <CheckCircleOutlined /> : <WarningOutlined />}
        className="nodrag"
        color={installed ? 'green' : 'danger'}
        onClick={() => navigate('/settings/mcp/mcp-install')}
      />
    )
  }

  const onHelp = () => {
    window.open('https://the-boss.know-me.tools/docs/advanced-basic/mcp', '_blank')
  }

  const isUvInstalled = uvStatus?.available ?? false
  const isBunInstalled = bunStatus?.available ?? false

  return (
    <Container>
      <Alert
        type={isUvInstalled ? 'success' : 'warning'}
        style={{ borderRadius: 'var(--list-item-border-radius)' }}
        description={
          <VStack>
            <SettingRow style={{ width: '100%' }}>
              <SettingSubtitle style={{ margin: 0, fontWeight: 'normal' }}>
                {getDependencyLabel('uv', uvStatus)}
              </SettingSubtitle>
              {uvStatus?.installSupported && uvStatus.source !== 'bundled' && (
                <Button
                  type="primary"
                  onClick={installUV}
                  loading={isInstallingUv}
                  disabled={isInstallingUv}
                  size="small">
                  {isInstallingUv ? t('settings.mcp.dependenciesInstalling') : t('settings.mcp.install')}
                </Button>
              )}
            </SettingRow>
            <SettingRow style={{ width: '100%' }}>
              <SettingDescription style={{ margin: 0, fontWeight: 'normal' }}>
                {uvStatus?.resolvedPath || uvStatus?.bundledPath}
              </SettingDescription>
            </SettingRow>
          </VStack>
        }
      />
      <Alert
        type={isBunInstalled ? 'success' : 'warning'}
        style={{ borderRadius: 'var(--list-item-border-radius)' }}
        description={
          <VStack>
            <SettingRow style={{ width: '100%' }}>
              <SettingSubtitle style={{ margin: 0, fontWeight: 'normal' }}>
                {getDependencyLabel('bun', bunStatus)}
              </SettingSubtitle>
              {bunStatus?.installSupported && bunStatus.source !== 'bundled' && (
                <Button
                  type="primary"
                  onClick={installBun}
                  loading={isInstallingBun}
                  disabled={isInstallingBun}
                  size="small">
                  {isInstallingBun ? t('settings.mcp.dependenciesInstalling') : t('settings.mcp.install')}
                </Button>
              )}
            </SettingRow>
            <SettingRow style={{ width: '100%' }}>
              <SettingDescription style={{ margin: 0, fontWeight: 'normal' }}>
                {bunStatus?.resolvedPath || bunStatus?.bundledPath}
              </SettingDescription>
            </SettingRow>
          </VStack>
        }
      />
      <Center>
        <Button type="link" onClick={onHelp} icon={<QuestionCircleOutlined />}>
          {t('settings.mcp.installHelp')}
        </Button>
      </Center>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  margin-bottom: 20px;
  gap: 12px;
  padding-top: 50px;
`

export default InstallNpxUv
