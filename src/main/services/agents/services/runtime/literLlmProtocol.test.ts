import { describe, expect, it } from 'vitest'

import { buildUarConfig, resolveLiterLlmProtocol } from './UniversalAgentRuntimeService'

describe('resolveLiterLlmProtocol', () => {
  it('uses chat for MiniMax providers (they only support chat-completions, not /v1/responses)', () => {
    expect(resolveLiterLlmProtocol({ providerId: 'minimax' })).toBe('chat')
    expect(resolveLiterLlmProtocol({ providerId: 'minimax-global' })).toBe('chat')
  })

  it('defaults unknown providers to chat (guardrail — never auto/responses)', () => {
    expect(resolveLiterLlmProtocol({ providerId: 'some-openai-compatible' })).toBe('chat')
    expect(resolveLiterLlmProtocol({})).toBe('chat')
  })

  it('uses responses only for providers explicitly known to support it', () => {
    expect(resolveLiterLlmProtocol({ providerId: 'openai' })).toBe('responses')
    expect(resolveLiterLlmProtocol({ providerId: 'xai' })).toBe('responses')
  })

  it("honors the model's endpoint_type over the provider id", () => {
    expect(resolveLiterLlmProtocol({ providerId: 'openai', endpointType: 'openai' })).toBe('chat')
    expect(resolveLiterLlmProtocol({ providerId: 'minimax-global', endpointType: 'openai-response' })).toBe('responses')
    expect(resolveLiterLlmProtocol({ providerId: 'minimax-global', endpointType: 'anthropic' })).toBe('chat')
  })

  it('is case-insensitive on the provider id', () => {
    expect(resolveLiterLlmProtocol({ providerId: 'MiniMax-Global' })).toBe('chat')
    expect(resolveLiterLlmProtocol({ providerId: 'OpenAI' })).toBe('responses')
  })
})

describe('buildUarConfig protocol field', () => {
  const base = {
    port: 1,
    grpcPort: 2,
    rocksDbPath: '/tmp/db',
    uploadsPath: '/tmp/uploads',
    nativeTools: {
      fileToolsEnabled: false,
      webFetchEnabled: false,
      terminalExecEnabled: false
    }
  }

  it('emits protocol: "chat" for a MiniMax provider (regression for wss://…/v1/responses 404)', () => {
    const yaml = buildUarConfig({
      ...base,
      providerOptions: {
        providerId: 'minimax-global',
        apiHost: 'https://api.minimax.io/v1/',
        modelId: 'MiniMax-M2'
      }
    })
    expect(yaml).toContain('protocol: "chat"')
    expect(yaml).not.toContain('protocol: "auto"')
  })

  it('emits protocol: "responses" for OpenAI', () => {
    const yaml = buildUarConfig({
      ...base,
      providerOptions: { providerId: 'openai', apiHost: 'https://api.openai.com', modelId: 'gpt-5.2' }
    })
    expect(yaml).toContain('protocol: "responses"')
  })
})
