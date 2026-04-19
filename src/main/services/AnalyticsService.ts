import { loggerService } from '@logger'
import { generateUserAgent } from '@main/utils/systemInfo'
import type { AnalyticsEventPayload, TokenUsageData } from '@shared/analytics'
import { CONTROL_PLANE_API_URL } from '@shared/config/branding'
import { APP_NAME } from '@shared/config/constant'
import { app } from 'electron'

import { configManager } from './ConfigManager'

const logger = loggerService.withContext('AnalyticsService')

class AnalyticsService {
  private static instance: AnalyticsService
  private initialized = false

  public static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService()
    }
    return AnalyticsService.instance
  }

  public init(): void {
    this.initialized = true
    void this.sendEvent('app_launch', {
      version: app.getVersion(),
      os: process.platform
    })

    logger.info('Analytics service initialized')
  }

  public trackTokenUsage(data: TokenUsageData): void {
    if (!this.initialized || !configManager.getEnableDataCollection()) {
      return
    }

    void this.sendEvent('token_usage', { ...data })
  }

  public async trackAppUpdate(): Promise<void> {
    if (!this.initialized) {
      return
    }

    await this.sendEvent('app_update', {
      version: app.getVersion()
    })
  }

  public async destroy(): Promise<void> {
    this.initialized = false
    logger.info('Analytics service destroyed')
  }

  private async sendEvent(event: AnalyticsEventPayload['event'], data?: Record<string, unknown>): Promise<void> {
    try {
      const payload: AnalyticsEventPayload = {
        event,
        clientId: configManager.getClientId(),
        channel: 'the-boss',
        appName: APP_NAME,
        appVersion: `v${app.getVersion()}`,
        os: process.platform,
        data
      }

      await fetch(`${CONTROL_PLANE_API_URL}/analytics/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': generateUserAgent(),
          'Client-Id': configManager.getClientId(),
          'App-Name': APP_NAME,
          'App-Version': `v${app.getVersion()}`,
          OS: process.platform
        },
        body: JSON.stringify(payload)
      })
    } catch (error) {
      logger.warn('Analytics event delivery failed', { event, error })
    }
  }
}

export const analyticsService = AnalyticsService.getInstance()
