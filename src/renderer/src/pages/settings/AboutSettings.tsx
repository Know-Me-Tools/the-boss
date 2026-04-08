import { GithubOutlined } from '@ant-design/icons'
import IndicatorLight from '@renderer/components/IndicatorLight'
import { HStack } from '@renderer/components/Layout'
import UpdateDialogPopup from '@renderer/components/Popups/UpdateDialogPopup'
import { useBrandAssets } from '@renderer/config/brand'
import { APP_NAME } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setUpdateState } from '@renderer/store/runtime'
import { runAsyncFunction } from '@renderer/utils'
import {
  PUBLIC_CAREERS_URL,
  PUBLIC_DOCS_URL,
  PUBLIC_ENTERPRISE_URL,
  PUBLIC_ISSUES_URL,
  PUBLIC_RELEASES_URL,
  PUBLIC_REPO_URL,
  PUBLIC_SUPPORT_URL,
  PUBLIC_WEBSITE_URL
} from '@shared/config/branding'
import { UpgradeChannel } from '@shared/config/constant'
import { Button, Progress, Radio, Row, Switch, Tag, Tooltip } from 'antd'
import { debounce } from 'lodash'
import { Briefcase, Bug, Building2, Globe, Mail, Rss } from 'lucide-react'
import { BadgeQuestionMark } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingTitle } from '.'

const AboutSettings: FC = () => {
  const [version, setVersion] = useState('')
  const [isPortable, setIsPortable] = useState(false)
  const { t } = useTranslation()
  const { autoCheckUpdate, setAutoCheckUpdate, testPlan, setTestPlan, testChannel, setTestChannel } = useSettings()
  const { theme } = useTheme()
  const { lockup } = useBrandAssets()
  const dispatch = useAppDispatch()
  const { update } = useRuntime()

  const onCheckUpdate = debounce(
    async () => {
      if (update.checking || update.downloading) {
        return
      }

      if (update.downloaded) {
        // Open update dialog directly in renderer
        void UpdateDialogPopup.show({ releaseInfo: update.info || null })
        return
      }

      dispatch(setUpdateState({ checking: true, manualCheck: true }))

      try {
        await window.api.checkForUpdate()
      } catch (error) {
        dispatch(setUpdateState({ manualCheck: false }))
        window.toast.error(t('settings.about.updateError'))
      }

      dispatch(setUpdateState({ checking: false }))
    },
    2000,
    { leading: true, trailing: false }
  )

  const onOpenWebsite = (url: string) => {
    void window.api.openWebsite(url)
  }

  const openSupport = async () => {
    onOpenWebsite(PUBLIC_SUPPORT_URL)
  }

  const debug = async () => {
    await window.api.devTools.toggle()
  }

  const showEnterprise = async () => {
    onOpenWebsite(PUBLIC_ENTERPRISE_URL)
  }

  const showReleases = async () => {
    onOpenWebsite(PUBLIC_RELEASES_URL)
  }

  const currentChannelByVersion =
    [
      { pattern: `-${UpgradeChannel.BETA}.`, channel: UpgradeChannel.BETA },
      { pattern: `-${UpgradeChannel.RC}.`, channel: UpgradeChannel.RC }
    ].find(({ pattern }) => version.includes(pattern))?.channel || UpgradeChannel.LATEST

  const handleTestChannelChange = async (value: UpgradeChannel) => {
    if (testPlan && currentChannelByVersion !== UpgradeChannel.LATEST && value !== currentChannelByVersion) {
      window.toast.warning(t('settings.general.test_plan.version_channel_not_match'))
    }
    setTestChannel(value)
    // Clear update info when switching upgrade channel
    dispatch(
      setUpdateState({
        available: false,
        info: null,
        downloaded: false,
        checking: false,
        downloading: false,
        downloadProgress: 0
      })
    )
  }

  // Get available test version options based on current version
  const getAvailableTestChannels = () => {
    return [
      {
        tooltip: t('settings.general.test_plan.rc_version_tooltip'),
        label: t('settings.general.test_plan.rc_version'),
        value: UpgradeChannel.RC
      },
      {
        tooltip: t('settings.general.test_plan.beta_version_tooltip'),
        label: t('settings.general.test_plan.beta_version'),
        value: UpgradeChannel.BETA
      }
    ]
  }

  const handleSetTestPlan = (value: boolean) => {
    setTestPlan(value)
    dispatch(
      setUpdateState({
        available: false,
        info: null,
        downloaded: false,
        checking: false,
        downloading: false,
        downloadProgress: 0
      })
    )

    if (value === true) {
      setTestChannel(getTestChannel())
    }
  }

  const getTestChannel = () => {
    if (testChannel === UpgradeChannel.LATEST) {
      return UpgradeChannel.RC
    }
    return testChannel
  }

  useEffect(() => {
    void runAsyncFunction(async () => {
      const appInfo = await window.api.getAppInfo()
      setVersion(appInfo.version)
      setIsPortable(appInfo.isPortable)
    })
    setAutoCheckUpdate(autoCheckUpdate)
  }, [autoCheckUpdate, setAutoCheckUpdate])

  const onOpenDocs = () => {
    void window.api.openWebsite(PUBLIC_DOCS_URL)
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>
          {t('settings.about.title')}
          <HStack alignItems="center">
            <Link to={PUBLIC_REPO_URL}>
              <GithubOutlined
                style={{
                  marginRight: 4,
                  color: 'var(--color-text)',
                  fontSize: 20
                }}
              />
            </Link>
          </HStack>
        </SettingTitle>
        <SettingDivider />
        <AboutHeader>
          <Row align="middle">
            <AvatarWrapper onClick={() => onOpenWebsite(PUBLIC_REPO_URL)}>
              {update.downloadProgress > 0 && (
                <ProgressCircle
                  type="circle"
                  size={84}
                  percent={update.downloadProgress}
                  showInfo={false}
                  strokeLinecap="butt"
                  strokeColor="#67ad5b"
                />
              )}
              <BrandLockup src={lockup} alt={APP_NAME} />
            </AvatarWrapper>
            <VersionWrapper>
              <Description>{t('settings.about.description')}</Description>
              <Tag
                onClick={() => onOpenWebsite(PUBLIC_RELEASES_URL)}
                color="cyan"
                style={{ marginTop: 8, cursor: 'pointer' }}>
                v{version}
              </Tag>
            </VersionWrapper>
          </Row>
          {!isPortable && (
            <CheckUpdateButton
              onClick={onCheckUpdate}
              loading={update.checking}
              disabled={update.downloading || update.checking}>
              {update.downloading
                ? t('settings.about.downloading')
                : update.available
                  ? t('settings.about.checkUpdate.available')
                  : t('settings.about.checkUpdate.label')}
            </CheckUpdateButton>
          )}
        </AboutHeader>
        {!isPortable && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.general.auto_check_update.title')}</SettingRowTitle>
              <Switch value={autoCheckUpdate} onChange={(v) => setAutoCheckUpdate(v)} />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.general.test_plan.title')}</SettingRowTitle>
              <Tooltip title={t('settings.general.test_plan.tooltip')} trigger={['hover', 'focus']}>
                <Switch value={testPlan} onChange={(v) => handleSetTestPlan(v)} />
              </Tooltip>
            </SettingRow>
            {testPlan && (
              <>
                <SettingDivider />
                <SettingRow>
                  <SettingRowTitle>{t('settings.general.test_plan.version_options')}</SettingRowTitle>
                  <Radio.Group
                    size="small"
                    buttonStyle="solid"
                    value={getTestChannel()}
                    onChange={(e) => handleTestChannelChange(e.target.value)}>
                    {getAvailableTestChannels().map((option) => (
                      <Tooltip key={option.value} title={option.tooltip}>
                        <Radio.Button value={option.value}>{option.label}</Radio.Button>
                      </Tooltip>
                    ))}
                  </Radio.Group>
                </SettingRow>
              </>
            )}
          </>
        )}
      </SettingGroup>
      {update.info && update.available && (
        <SettingGroup theme={theme}>
          <SettingRow>
            <SettingRowTitle>
              {t('settings.about.updateAvailable', {
                version: update.info.version
              })}
              <IndicatorLight color="green" />
            </SettingRowTitle>
          </SettingRow>
          <UpdateNotesWrapper className="markdown">
            <Markdown>
              {typeof update.info.releaseNotes === 'string'
                ? update.info.releaseNotes.replace(/\n/g, '\n\n')
                : update.info.releaseNotes?.map((note) => note.note).join('\n')}
            </Markdown>
          </UpdateNotesWrapper>
        </SettingGroup>
      )}
      <SettingGroup theme={theme}>
        <SettingRow>
          <SettingRowTitle>
            <BadgeQuestionMark size={18} />
            {t('docs.title')}
          </SettingRowTitle>
          <Button onClick={onOpenDocs}>{t('settings.about.website.button')}</Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <Rss size={18} />
            {t('settings.about.releases.title')}
          </SettingRowTitle>
          <Button onClick={showReleases}>{t('settings.about.releases.button')}</Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <Globe size={18} />
            {t('settings.about.website.title')}
          </SettingRowTitle>
          <Button onClick={() => onOpenWebsite(PUBLIC_WEBSITE_URL)}>{t('settings.about.website.button')}</Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <GithubOutlined style={{ fontSize: 18 }} />
            {t('settings.about.feedback.title')}
          </SettingRowTitle>
          <Button onClick={() => onOpenWebsite(PUBLIC_ISSUES_URL)}>{t('settings.about.feedback.button')}</Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <Building2 size={18} />
            {t('settings.about.enterprise.title')}
          </SettingRowTitle>
          <Button onClick={showEnterprise}>{t('settings.about.website.button')}</Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <Mail size={18} />
            {t('settings.about.contact.title')}
          </SettingRowTitle>
          <Button onClick={openSupport}>{t('settings.about.contact.button')}</Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <Briefcase size={18} />
            {t('settings.about.careers.title')}
          </SettingRowTitle>
          <Button onClick={() => onOpenWebsite(PUBLIC_CAREERS_URL)}>{t('settings.about.careers.button')}</Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <Bug size={18} />
            {t('settings.about.debug.title')}
          </SettingRowTitle>
          <Button onClick={debug}>{t('settings.about.debug.open')}</Button>
        </SettingRow>
      </SettingGroup>
    </SettingContainer>
  )
}

const AboutHeader = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 5px 0;
`

const VersionWrapper = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 8px;
`

const Description = styled.div`
  font-size: 14px;
  color: var(--color-text-2);
  font-family: var(--font-family-body);
  max-width: 320px;
  text-align: left;
`

const CheckUpdateButton = styled(Button)``

const AvatarWrapper = styled.div`
  position: relative;
  cursor: pointer;
  display: flex;
  align-items: center;
  margin-right: 24px;
`

const ProgressCircle = styled(Progress)`
  position: absolute;
  top: -2px;
  left: -2px;
`

const BrandLockup = styled.img`
  display: block;
  width: 240px;
  max-width: 44vw;
  height: auto;
`

export const SettingRowTitle = styled.div`
  font-size: 14px;
  line-height: 18px;
  color: var(--color-text-1);
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  .anticon {
    font-size: 16px;
    color: var(--color-text-1);
  }
`

const UpdateNotesWrapper = styled.div`
  padding: 12px 0;
  margin: 8px 0;
  background-color: var(--color-bg-2);
  border-radius: 6px;
  color: var(--color-text-2);
  font-size: 14px;

  p {
    margin: 0;
  }
`

export default AboutSettings
