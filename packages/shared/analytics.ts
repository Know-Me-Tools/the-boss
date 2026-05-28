export interface TokenUsageData {
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  source?: 'chat' | 'agent'
}

export interface AnalyticsEventPayload {
  event: 'app_launch' | 'app_update' | 'token_usage'
  clientId: string
  channel: string
  appName: string
  appVersion: string
  os: string
  data?: Record<string, unknown>
}
