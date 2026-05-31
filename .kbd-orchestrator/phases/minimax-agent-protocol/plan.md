# KBD Plan — Phase: `minimax-agent-protocol`

**Backend:** native KBD (no evolver). OpenSpec note: `openspec/` exists at root but is **dormant** — `openspec/changes/` holds only `archive`, `openspec/specs/` is empty, and no `project.json` sets `change_backend: openspec`. Prior phases all used native KBD changes, so this phase continues with native KBD for consistency.
**Branch:** `fix/minimax-agent-protocol-chat` (off `main` `6f9180116`)
**Date:** 2026-05-31
**Source of plan:** `.kbd-orchestrator/phases/minimax-agent-protocol/assessment.md`

## Context (from assessment)

The MiniMax 404 (`wss://api.minimax.io/v1/responses`) in Agent conversations is **already fixed in source** (commit `f1b024974`: `resolveLiterLlmProtocol` + guardrail + `endpoint_type` plumbing; tests 7/7, runtime suite 137/137; tsgo/biome clean). Firecrawl + HTTP probes confirmed **no upstream MiniMax change** — `/v1/responses` never existed; the documented surface is chat-completions only. The failing instance is a **stale 1.9.4 install** that predates the fix.

Therefore this phase is **delivery + proof + merge**, not new feature code. The change list is short and ordered by dependency.

## Ordered Change List

| # | Change ID | Title | Type | Depends on | Recommended agent | Gate |
|---|---|---|---|---|---|---|
| 1 | `change-001-verify-fix-in-source` | Re-verify the fix is intact on branch (tests + typecheck + biome + no stray `auto`) | verify | — | build-error-resolver (only if red) | `pnpm test:main` runtime suite green; tsgo clean; biome clean |
| 2 | `change-002-install-1.9.7-build` | Install the unsigned 1.9.7 build that contains the fix; confirm in-app version | delivery | 1 | — (manual / user) | App reports 1.9.7; launches past Gatekeeper |
| 3 | `change-003-live-smoke-minimax-agent` | Live smoke test: standard MiniMax provider in an Agent conversation streams normally; **no** `/v1/responses` request | verify (the real proof) | 2 | e2e-runner (assist) / user | Normal streamed reply; zero `wss://…/v1/responses`; UAR config shows `protocol: "chat"` |
| 4 | `change-004-regression-responses-providers` | Regression: an OpenAI/xAI agent model still uses `responses`; non-agent MiniMax chat still works | verify | 2 | e2e-runner (assist) / user | OpenAI/xAI agent path unaffected; normal MiniMax chat unaffected |
| 5 | `change-005-push-and-open-draft-pr` | Push `fix/minimax-agent-protocol-chat`; open **draft** PR via `gh-create-pr` to fork `Know-Me-Tools/the-boss` **main** (not upstream, not v2) | delivery | 1,3 | gh-create-pr skill | PR open, template complete, CI green |

> Changes 2–4 are user/manual verification gates (they need the running app + a real MiniMax API key). Change 1 and 5 are agent-executable. No new source edits are planned unless change 3 surfaces a second `auto`-emitting code path (none found in static analysis).

## Per-change detail

### change-001 — Re-verify the fix in source (idempotent)
- `fnm use 24 && pnpm test:main src/main/services/agents/services/runtime/` → expect 137/137 (incl. 7 protocol tests).
- `pnpm exec tsgo --noEmit -p tsconfig.node.json` → no errors from the 3 changed files.
- `pnpm exec biome check` on the 3 files → clean.
- `grep` for `protocol: "auto"` in `src/`+`packages/` → only the negative test assertion remains.
- **No code changes expected.** If red → build-error-resolver, minimal diff, re-run.

### change-002 — Install 1.9.7
- Open `dist/The-Boss-1.9.7-arm64.dmg`, drag to Applications.
- Unsigned: right-click → Open, or `xattr -dr com.apple.quarantine "/Applications/The Boss.app"`.
- Confirm **Settings/About shows 1.9.7** (the prior failing app was 1.9.4).

### change-003 — Live smoke (definition of done for the bug)
- Configure the **standard built-in MiniMax provider** (Global / `api.minimax.io`) with a real key.
- Start an **Agent** conversation on a MiniMax model; send a message.
- **Pass:** normal streamed reply; **no** `wss://…/v1/responses`; the generated UAR config shows `protocol: "chat"` (and the upstream call is `/v1/chat/completions`).
- **Fail:** any reconnect loop → capture the generated UAR config + provider id/endpoint_type and re-open assessment (look for a second `auto` source).

### change-004 — Regression
- OpenAI or xAI agent model still resolves to `responses` (allowlist intact).
- A non-agent (normal chat) MiniMax conversation still works.

### change-005 — Push + draft PR
- `git push -u origin fix/minimax-agent-protocol-chat`.
- Use **`gh-create-pr`** skill; target **fork `Know-Me-Tools/the-boss` `main`**; **draft**; fill every template section; exclude unrelated stashed `RuntimeSettings.tsx`.

## Risks (carried from assessment)
- **R1 Stale-install confusion** — MUST verify in-app 1.9.7 before testing (change-002 gate).
- **R3 Allowlist scope** — `responses` only for openai/xai; document for future providers.
- **R4 Unsigned/Gatekeeper** — operational only; quarantine bypass noted.

## Exit criteria for the phase
All five changes DONE: source verified green, 1.9.7 installed, MiniMax agent smoke test passes with no `/v1/responses`, regressions clean, draft PR open with green CI. Then `/kbd-reflect`.
