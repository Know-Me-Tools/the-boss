import path from 'node:path'

import { isDev, isPortable, isWin } from '@main/constant'
import { app } from 'electron'

import { getDataPath } from './utils'

const DEV_USER_DATA_CONTAINER = 'CherryStudioDev20260405'
const PACKAGED_USER_DATA_CONTAINER = 'CherryStudioBuild20260403'

if (isDev) {
  app.setPath('userData', path.join(app.getPath('appData'), DEV_USER_DATA_CONTAINER))
} else if (app.isPackaged && !isPortable) {
  // Force this build onto a fresh storage container instead of reusing prior installed app data.
  app.setPath('userData', path.join(app.getPath('appData'), PACKAGED_USER_DATA_CONTAINER))
}

export const DATA_PATH = getDataPath()

export const titleBarOverlayDark = {
  height: 42,
  color: isWin ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0)',
  symbolColor: '#fff'
}

export const titleBarOverlayLight = {
  height: 42,
  color: 'rgba(255,255,255,0)',
  symbolColor: '#000'
}

global.CHERRYAI_CLIENT_SECRET = import.meta.env.MAIN_VITE_CHERRYAI_CLIENT_SECRET
