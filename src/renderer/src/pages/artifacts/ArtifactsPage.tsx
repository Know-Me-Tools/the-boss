import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useArtifactSettings } from '@renderer/hooks/useArtifactSettings'
import ArtifactLibrarySection from '@renderer/pages/settings/ArtifactSettings/ArtifactLibrarySection'
import { Spin } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const ArtifactsPage: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { settings, loading } = useArtifactSettings()

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('title.artifacts')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        {loading ? (
          <LoadingContainer>
            <Spin />
          </LoadingContainer>
        ) : (
          <ArtifactLibrarySection theme={theme} settings={settings} />
        )}
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`

const ContentContainer = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  background: var(--color-background);
`

const LoadingContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
`

export default ArtifactsPage
