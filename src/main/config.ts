import path from 'node:path'

import { isDev, isPortable, isWin } from '@main/constant'
import { APP_USER_DATA_CONTAINER, APP_USER_DATA_CONTAINER_DEV } from '@shared/config/branding'
import { BRAND_TEXT_DARK, BRAND_TEXT_LIGHT } from '@shared/config/brandTheme'
import { app } from 'electron'

import { getDataPath } from './utils'

if (isDev) {
  app.setPath('userData', path.join(app.getPath('appData'), APP_USER_DATA_CONTAINER_DEV))
} else if (app.isPackaged && !isPortable) {
  app.setPath('userData', path.join(app.getPath('appData'), APP_USER_DATA_CONTAINER))
}

export const DATA_PATH = getDataPath()

export const titleBarOverlayDark = {
  height: 42,
  color: isWin ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0)',
  symbolColor: BRAND_TEXT_DARK
}

export const titleBarOverlayLight = {
  height: 42,
  color: 'rgba(255,255,255,0)',
  symbolColor: BRAND_TEXT_LIGHT
}

global.CHERRYAI_CLIENT_SECRET = import.meta.env.MAIN_VITE_CHERRYAI_CLIENT_SECRET
