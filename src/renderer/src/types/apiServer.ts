export type ApiServerConfig = {
  enabled: boolean
  host: string
  port: number
  apiKey: string
}

export type ApiServerConfigPatch = Partial<ApiServerConfig>

export type GetApiServerStatusResult = {
  running: boolean
  config: ApiServerConfig | null
}

export type StartApiServerStatusResult =
  | {
      success: true
    }
  | {
      success: false
      error: string
    }

export type RestartApiServerStatusResult =
  | {
      success: true
    }
  | {
      success: false
      error: string
    }

export type StopApiServerStatusResult =
  | {
      success: true
    }
  | {
      success: false
      error: string
    }

export type SetApiServerConfigResult =
  | {
      success: true
      config: ApiServerConfig
    }
  | {
      success: false
      error: string
    }
