# minimax-003-live-smoke-minimax-agent

## Purpose

Prove the fixed installed build routes MiniMax Agent conversations through Chat Completions instead of the nonexistent MiniMax Responses endpoint.

## Scope

This is a live verification change requiring a real MiniMax API key.

## Success Criteria

- A MiniMax Agent conversation streams a normal response.
- Generated UAR/liter-llm configuration uses `protocol: "chat"`.
- No request targets `wss://api.minimax.io/v1/responses` or `/v1/responses`.

## Failure Handling

If the smoke test fails, capture the provider id, endpoint, model id, endpoint type, generated UAR config, and request URL before reopening implementation work.
