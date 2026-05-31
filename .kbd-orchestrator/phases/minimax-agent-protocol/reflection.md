# KBD Reflection — Phase: `minimax-agent-protocol`

**Status:** ⚠️ **INTERIM** (phase not closed — manual verification + PR still pending)
**Date:** 2026-05-31
**Branch:** `fix/minimax-agent-protocol-chat` · **Fix commit:** `f1b024974`
**Backend:** native KBD · execution hybrid

> This reflection is written at the user's request mid-phase. Per the skill's
> prerequisites (all changes DONE → QA passed → archived) the phase is **not**
> eligible for closure: changes 002–004 are user-owned live tests on the 1.9.7
> build and change-005 (push + draft PR) is held. The waypoint is therefore
> **left on `minimax-agent-protocol`** and is **not** advanced to a new phase.

## Goal Achievement

Phase goal: the **standard built-in MiniMax provider** works in **Agent conversations** — normal streamed reply over chat-completions, no `wss://…/v1/responses`, with a guardrail preventing other chat-only providers from regressing.

| Goal | Verdict | Evidence |
|---|---|---|
| Root cause identified (what changed) | **MET** | Firecrawl (MiniMax docs = chat-completions only; no Responses API) + HTTP probes (`/v1/responses` 404 never existed; `/v1/chat/completions` 401 exists). No upstream change — failing app was stale **1.9.4**. |
| Corrective code implemented | **MET** | `resolveLiterLlmProtocol` + guardrail + `endpoint_type` plumbing; generator emits resolver-driven `protocol`, no hard-coded `auto`. Commit `f1b024974`. |
| Automated regression coverage | **MET** | `literLlmProtocol.test.ts` 7/7; full runtime suite **137/137**; tsgo + biome clean. |
| Fix shipped to a runnable build | **PARTIAL** | Unsigned **1.9.7** dmg/zip built (contains fix). **Not yet installed** by user. |
| **Live proof** (MiniMax agent streams, no `/v1/responses`) | **NOT MET (pending)** | Requires the 1.9.7 app + a real MiniMax key — change-003, user-owned. |
| Regression (openai/xai still `responses`; non-agent MiniMax chat) | **NOT MET (pending)** | change-004, user-owned. |
| Branch merged / PR opened | **NOT MET (held)** | change-005 gated on change-003 pass. |

**Goal completion: ~60%** — engineering complete and verified in source/CI; the remaining ~40% is live verification + delivery (PR), which depend on the user.

## Delivered Changes

| # | Change | Status |
|---|---|---|
| 1 | minimax-001-verify-fix-in-source | ✅ DONE (137/137, tsgo/biome clean) |
| 2 | minimax-002-install-1.9.7-build | ⏳ pending (user) |
| 3 | minimax-003-live-smoke-minimax-agent | ⏳ pending (user) |
| 4 | minimax-004-regression-responses-providers | ⏳ pending (user) |
| 5 | minimax-005-push-and-open-draft-pr | ⏸ held (gate: change-003) |

## Artifact Quality Summary

| Metric | Value |
| --- | --- |
| Changes with QA | 0/1 executed (change-001 = verify-only, QA skipped per skip criteria) |
| First-pass pass rate | n/a (no artifact-producing changes executed this phase) |
| Changes requiring refinement | 0 |
| Total refinement iterations | 0 |

No artifact-refiner logs exist for this phase: the only code artifacts (commit `f1b024974`) were produced and test-gated in a prior session; change-001 only re-verified them. Changes 002–005 produce no refinable code artifacts (live tests + a PR).

### Recurring Constraint Violations
- None.

## Technical Debt Introduced
- **None.** Fix is additive and minimal (3 files, +112/-3). Guardrail allowlist (`responses` only for `openai`/`xai`) is explicit and documented.
- Minor watch item: if a future provider genuinely supports the Responses API, it must be added to the allowlist or set its model `endpoint_type: 'openai-response'`. Documented in assessment R3.

## Lessons Captured (for knowledge base)
1. **"It's not working" can mean "the installed build is stale."** The failing app was **1.9.4** (May 5), three releases behind the fix. Always verify the in-app version before re-debugging a "persisting" bug. → New gate: change-002 confirms 1.9.7 before any live test.
2. **Primary-source probing beats assumption.** Direct HTTP probes (`/v1/responses`=404, `/v1/chat/completions`=401) + official docs via firecrawl conclusively proved MiniMax never had a Responses API — closing the "what changed?" question definitively (nothing did).
3. **Default to the universal shape, allowlist the exotic.** UAR's `auto` mode optimistically picked Responses; the durable fix is to default chat-only-compatible (`chat`) and allowlist `responses`, rather than sniffing per host.
4. **Bundled vendor docs create grep noise.** Post-build asar contains vendored UAR docs mentioning `auto`; verify against **source** + the negative test assertion, not raw asar greps.

## Recommended Focus for Phase Continuation (not a new phase)
1. User installs `dist/The-Boss-1.9.7-arm64.dmg`, confirms 1.9.7 (change-002).
2. User runs the MiniMax agent live smoke (change-003) + regression (change-004).
3. On green, Claude executes change-005: push `fix/minimax-agent-protocol-chat` + open **draft** PR via `gh-create-pr` → fork `Know-Me-Tools/the-boss` `main` (never `v2`).
4. Then re-run `/kbd-reflect` to **close** the phase and advance the waypoint.

## Waypoint
**Not advanced.** Remains `minimax-agent-protocol` (execution_in_progress). Next pending change: `minimax-002-install-1.9.7-build`.
