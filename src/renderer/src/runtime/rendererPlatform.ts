import { loggerService } from '@logger'

import { getRendererCapabilities, getSafeWindowApi } from './environment'

const logger = loggerService.withContext('RendererPlatform')
const CUSTOM_MIN_APPS_STORAGE_KEY = 'custom-minapps.json'

export interface MiniAppStorage {
  kind: 'preload-file' | 'browser-storage' | 'unavailable'
  read(): Promise<string>
  write(content: string): Promise<void>
}

function createUnavailableStorage(): MiniAppStorage {
  return {
    kind: 'unavailable',
    async read() {
      return '[]'
    },
    async write() {}
  }
}

export function getMiniAppStorage(): MiniAppStorage {
  const api = getSafeWindowApi()
  const capabilities = getRendererCapabilities()

  if (capabilities.hasFileApi && api?.file?.read && api.file.writeWithId) {
    return {
      kind: 'preload-file',
      read: () => api.file.read(CUSTOM_MIN_APPS_STORAGE_KEY),
      write: (content: string) => api.file.writeWithId(CUSTOM_MIN_APPS_STORAGE_KEY, content)
    }
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    return {
      kind: 'browser-storage',
      async read() {
        return window.localStorage.getItem(CUSTOM_MIN_APPS_STORAGE_KEY) ?? '[]'
      },
      async write(content: string) {
        window.localStorage.setItem(CUSTOM_MIN_APPS_STORAGE_KEY, content)
      }
    }
  }

  logger.warn('Mini app storage is unavailable in this renderer runtime.')
  return createUnavailableStorage()
}

export async function openTrustedPreviewPath(path: string): Promise<void> {
  const api = getSafeWindowApi()

  if (api?.preview?.openTempHtml) {
    await api.preview.openTempHtml(path)
    return
  }

  if (api?.file?.openPath) {
    await api.file.openPath(path)
    return
  }

  throw new Error('Trusted preview path opening is unavailable in this renderer runtime.')
}
