# Current KBD Waypoint

**Project:** The Boss / Cherry Studio fork
**Active phase:** `minimax-agent-protocol`
**Status:** planned (change-001 already green)
**Branch:** `fix/minimax-agent-protocol-chat` · **Fix commit:** `f1b024974`
**Backend:** native KBD · **Date:** 2026-05-31

> Backend note: `openspec/` exists at root but is **dormant** (`changes/` holds
> only `archive`, `specs/` empty, no `project.json` change_backend). All prior
> phases used native KBD changes, so this phase continues with native KBD.

## What this phase fixes

MiniMax **Agent** conversations 404-looped on `wss://api.minimax.io/v1/responses`.
Root cause: the UAR config generator hard-coded liter-llm `protocol: "auto"`,
which auto-selects the OpenAI **Responses API** for the `/v1` host; MiniMax is
chat-completions-only. Fixed by `resolveLiterLlmProtocol` (defaults chat-only
providers to `chat`; `responses` only for openai/xai; model `endpoint_type`
precedence). **No upstream MiniMax change** — confirmed via firecrawl (docs are
chat-completions only) + HTTP probes (`/v1/responses` 404, `/v1/chat/completions`
401). The failing install was a stale **1.9.4** build.

## Ordered Changes

1. ✅ `minimax-001-verify-fix-in-source` — tests 137/137, tsgo/biome clean (DONE)
2. ⏳ `minimax-002-install-1.9.7-build` — install `dist/The-Boss-1.9.7-arm64.dmg`, confirm 1.9.7
3. ⏳ `minimax-003-live-smoke-minimax-agent` — MiniMax agent convo streams; no `/v1/responses`
4. ⏳ `minimax-004-regression-responses-providers` — openai/xai still `responses`; normal chat OK
5. ⏳ `minimax-005-push-and-open-draft-pr` — push + draft PR (gh-create-pr → fork `main`, **not v2**)

## Exact next command

```
open dist/The-Boss-1.9.7-arm64.dmg   # install, confirm 1.9.7, then live smoke test the MiniMax agent
```

## Next recommended action

Execute **change-002** (install 1.9.7) → **change-003** (live smoke test the
standard MiniMax provider in an Agent conversation). On green → **change-005**
push + draft PR via `gh-create-pr`. Per CLAUDE.md, never use `v2`.
