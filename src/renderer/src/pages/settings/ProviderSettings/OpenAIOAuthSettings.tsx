import { loggerService } from '@logger'
import type { OpenAIOAuthStatus } from '@shared/config/types'
import { Alert, Button, Space, Tag } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('OpenAIOAuthSettings')

const statusColorMap = {
  valid: 'green',
  missing: 'default',
  invalid: 'red',
  unsupported: 'orange',
  installed: 'green',
  stopped: 'default',
  starting: 'processing',
  running: 'green',
  error: 'red',
  healthy: 'green',
  unhealthy: 'red'
} as const

const OpenAIOAuthSettings = () => {
  const { t } = useTranslation()
  const [status, setStatus] = useState<OpenAIOAuthStatus | null>(null)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await window.api.openai_oauth.getStatus())
    } catch (error) {
      logger.error('Failed to refresh OpenAI OAuth status', error as Error)
      window.toast.error(t('settings.provider.openai.oauth.status_load_failed'))
    }
  }, [t])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const runAction = useCallback(
    async (actionName: string, action: () => Promise<{ success: boolean; message?: string }>) => {
      try {
        setLoadingAction(actionName)
        const result = await action()
        if (!result.success) {
          window.toast.error(result.message || t('settings.provider.openai.oauth.action_failed'))
        } else {
          window.toast.success(t('settings.provider.openai.oauth.action_success'))
        }
      } catch (error) {
        logger.error(`OpenAI OAuth action failed: ${actionName}`, error as Error)
        window.toast.error(t('settings.provider.openai.oauth.action_failed'))
      } finally {
        setLoadingAction(null)
        await refreshStatus()
      }
    },
    [refreshStatus, t]
  )

  const modelsSummary =
    status?.availableModels.length && status.availableModels.length > 0 ? status.availableModels.join(', ') : null
  const stateLabels = {
    valid: t('settings.provider.openai.oauth.state.valid'),
    missing: t('settings.provider.openai.oauth.state.missing'),
    invalid: t('settings.provider.openai.oauth.state.invalid'),
    unsupported: t('settings.provider.openai.oauth.state.unsupported'),
    installed: t('settings.provider.openai.oauth.state.installed'),
    stopped: t('settings.provider.openai.oauth.state.stopped'),
    starting: t('settings.provider.openai.oauth.state.starting'),
    running: t('settings.provider.openai.oauth.state.running'),
    error: t('settings.provider.openai.oauth.state.error'),
    healthy: t('settings.provider.openai.oauth.state.healthy'),
    unhealthy: t('settings.provider.openai.oauth.state.unhealthy')
  } as const

  return (
    <Container>
      <Alert
        type="warning"
        showIcon
        message={t('settings.provider.openai.oauth.warning_title')}
        description={t('settings.provider.openai.oauth.warning_description')}
        style={{ marginBottom: 10 }}
      />
      {status && (
        <>
          <StatusRow>
            <StatusLabel>{t('settings.provider.openai.oauth.credential_status')}</StatusLabel>
            <Tag color={statusColorMap[status.credentialStatus.state]}>{stateLabels[status.credentialStatus.state]}</Tag>
          </StatusRow>
          <StatusRow>
            <StatusLabel>{t('settings.provider.openai.oauth.install_status')}</StatusLabel>
            <Tag color={statusColorMap[status.installState]}>{stateLabels[status.installState]}</Tag>
          </StatusRow>
          <StatusRow>
            <StatusLabel>{t('settings.provider.openai.oauth.proxy_status')}</StatusLabel>
            <Tag color={statusColorMap[status.runState]}>{stateLabels[status.runState]}</Tag>
          </StatusRow>
          <StatusRow>
            <StatusLabel>{t('settings.provider.openai.oauth.health_status')}</StatusLabel>
            <Tag color={statusColorMap[status.healthState]}>{stateLabels[status.healthState]}</Tag>
          </StatusRow>
          <StatusRow>
            <StatusLabel>{t('settings.provider.openai.oauth.local_endpoint')}</StatusLabel>
            <Code>{status.baseUrl}</Code>
          </StatusRow>
          {status.credentialStatus.authFilePath && (
            <StatusRow>
              <StatusLabel>{t('settings.provider.openai.oauth.auth_file')}</StatusLabel>
              <Code>{status.credentialStatus.authFilePath}</Code>
            </StatusRow>
          )}
          {modelsSummary && (
            <StatusRow>
              <StatusLabel>{t('settings.provider.openai.oauth.available_models')}</StatusLabel>
              <StatusText>{modelsSummary}</StatusText>
            </StatusRow>
          )}
          {status.message && (
            <Alert
              type={status.credentialStatus.state === 'invalid' || status.healthState === 'unhealthy' ? 'error' : 'info'}
              showIcon
              message={status.message}
              style={{ marginTop: 10 }}
            />
          )}
        </>
      )}
      <Space style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <Button onClick={() => void refreshStatus()} loading={loadingAction === 'refresh'}>
          {t('settings.provider.openai.oauth.refresh')}
        </Button>
        <Button
          onClick={() => void runAction('install', () => window.api.openai_oauth.install())}
          loading={loadingAction === 'install'}
          disabled={status?.installState === 'installed'}>
          {t('settings.provider.openai.oauth.install')}
        </Button>
        <Button
          type="primary"
          onClick={() => void runAction('start', () => window.api.openai_oauth.startProxy())}
          loading={loadingAction === 'start'}
          disabled={status?.installState !== 'installed' || status?.credentialStatus.state !== 'valid'}>
          {t('settings.provider.openai.oauth.start')}
        </Button>
        <Button
          danger
          onClick={() => void runAction('stop', () => window.api.openai_oauth.stopProxy())}
          loading={loadingAction === 'stop'}
          disabled={status?.runState !== 'running'}>
          {t('settings.provider.openai.oauth.stop')}
        </Button>
      </Space>
    </Container>
  )
}

const Container = styled.div`
  padding-top: 10px;
`

const StatusRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 8px;
`

const StatusLabel = styled.span`
  min-width: 160px;
  color: var(--color-text-2);
`

const StatusText = styled.span`
  color: var(--color-text);
  word-break: break-word;
`

const Code = styled.code`
  color: var(--color-text);
  word-break: break-all;
`

export default OpenAIOAuthSettings
