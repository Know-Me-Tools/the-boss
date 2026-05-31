# change-003 — Live smoke: MiniMax standard provider in Agent conversation

Phase: minimax-agent-protocol · Type: verify (the real proof) · Agent: user / e2e-runner assist

## Tasks
- [ ] Configure built-in MiniMax provider (Global / api.minimax.io) with a real API key
- [ ] Start an Agent conversation on a MiniMax model; send a message
- [ ] PASS: normal streamed reply; NO wss://…/v1/responses; UAR config shows protocol: "chat"; upstream call is /v1/chat/completions
- [ ] FAIL path: capture generated UAR config + provider id/endpoint_type; re-open assessment

Done gate: streamed reply, zero /v1/responses requests.
