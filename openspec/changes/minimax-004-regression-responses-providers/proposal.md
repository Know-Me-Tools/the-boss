# minimax-004-regression-responses-providers

## Purpose

Verify the protocol resolver did not regress providers that intentionally support Responses, and did not break normal MiniMax assistant chat.

## Scope

This is a regression verification change.

## Success Criteria

- OpenAI or xAI agent models still resolve to `responses` where expected.
- Normal non-agent MiniMax assistant chat still works.

## Notes

MiniMax should remain Chat Completions-only for Agent transport.
