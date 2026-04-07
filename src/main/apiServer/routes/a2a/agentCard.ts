import {
  A2A_PROTOCOL_VERSION,
  A2UI_A2A_EXTENSION_URI,
  A2UI_MIME_TYPE,
  A2UI_SCHEMA_VERSION
} from '@main/apiServer/protocols/versions'
import type { Request } from 'express'

export interface TheBossAgentCard {
  name: string
  description: string
  version: string
  protocolVersion: typeof A2A_PROTOCOL_VERSION
  preferredTransport: 'JSONRPC' | 'HTTP+JSON'
  url: string
  capabilities: {
    streaming: boolean
    extensions: Array<{
      uri: string
      params: Record<string, unknown>
      description?: string
    }>
  }
  authentication: {
    schemes: Array<{ scheme: string; description: string }>
  }
  defaultInputModes: string[]
  defaultOutputModes: string[]
  skills: Array<{ id: string; name: string; description: string; tags?: string[] }>
}

/**
 * Builds a public Agent Card for A2A discovery. `baseUrl` must be the HTTP origin of the API (e.g. http://127.0.0.1:8848).
 */
export function buildTheBossAgentCard(baseUrl: string): TheBossAgentCard {
  const normalized = baseUrl.replace(/\/$/, '')
  return {
    name: 'The Boss Agents',
    description:
      'Local The Boss desktop agent runtime: JSON-RPC A2A at /v1/a2a, REST agents under /v1/agents, AG-UI SSE at /v1/agents/{agentId}/sessions/{sessionId}/messages/ag-ui.',
    version: '1.0.0',
    protocolVersion: A2A_PROTOCOL_VERSION,
    preferredTransport: 'JSONRPC',
    url: `${normalized}/v1/a2a`,
    capabilities: {
      streaming: true,
      extensions: [
        {
          uri: A2UI_A2A_EXTENSION_URI,
          description: 'A2UI generative UI payloads (application/json+a2ui DataParts)',
          params: {
            supportedCatalogIds: ['basic', 'the-boss-default'],
            schemaVersion: A2UI_SCHEMA_VERSION
          }
        }
      ]
    },
    authentication: {
      schemes: [
        {
          scheme: 'Bearer',
          description: 'Same API key as other /v1 routes (Authorization: Bearer <apiKey>)'
        }
      ]
    },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', A2UI_MIME_TYPE],
    skills: [
      {
        id: 'the-boss-session',
        name: 'Agent session messaging',
        description: 'Send user text to a configured agent session via metadata.theBoss routing.',
        tags: ['session', 'claude-code', 'cherry-claw']
      }
    ]
  }
}

export function getRequestBaseUrl(req: Request): string {
  const host = req.get('host') || '127.0.0.1'
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http')
  return `${proto}://${host}`
}
