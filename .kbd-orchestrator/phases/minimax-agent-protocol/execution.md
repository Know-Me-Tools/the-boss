# KBD Execution — Phase: `minimax-agent-protocol`

**Backend:** `hybrid` (native-tool for verify/PR; manual for live-app verification)
**Branch:** `fix/minimax-agent-protocol-chat` · **Fix commit:** `f1b024974`
**Date:** 2026-05-31
**Source:** `.kbd-orchestrator/phases/minimax-agent-protocol/plan.md`

## Backend rationale

The corrective code is already committed. Remaining work splits cleanly:
- **native-tool** (Claude-executable now): change-001 (re-verify), change-005 (push + draft PR via gh-create-pr).
- **manual** (require the running 1.9.7 app + a real MiniMax API key): change-002 (install), change-003 (live smoke), change-004 (regression).

OpenSpec is dormant (only `openspec/changes/archive`), so native KBD changes are used.

## Dispatch ledger

| # | Change | Backend | Status | Evidence |
|---|---|---|---|---|
| 1 | minimax-001-verify-fix-in-source | native-tool | ✅ **DONE** | branch `fix/minimax-agent-protocol-chat`@`f1b024974`; runtime suite **18 files / 137 tests pass**; tsgo CLEAN for the 3 files; biome clean; only `protocol: "auto"` remaining is the negative test assertion in `literLlmProtocol.test.ts:56` |
| 2 | minimax-002-install-1.9.7-build | manual | ⏳ PENDING (user) | install `dist/The-Boss-1.9.7-arm64.dmg`; confirm in-app 1.9.7 |
| 3 | minimax-003-live-smoke-minimax-agent | manual | ⏳ PENDING (user) | MiniMax agent convo streams; no `/v1/responses`; UAR config `protocol: "chat"` |
| 4 | minimax-004-regression-responses-providers | manual | ⏳ PENDING (user) | openai/xai still `responses`; normal MiniMax chat OK |
| 5 | minimax-005-push-and-open-draft-pr | native-tool | ⏸ HELD | gated on change-003 pass per plan; run on user go-ahead |

## QA gate (artifact-refiner)

- change-001 modifies 3 files but is a **verify-only** change producing **no new artifacts** (the code artifacts were produced and committed in the prior session under commit `f1b024974`, already test-gated). Per the skill's skip criteria (verification step, no artifacts to refine), **QA gate skipped** for change-001.
- changes 002–004 are manual live-verification gates (no artifacts) → not subject to artifact-refiner.
- change-005 produces a PR (not a code artifact) → standard PR template compliance via gh-create-pr, not artifact-refiner.

## Next action

Execute manual **change-002 → change-003** (user, with MiniMax key on the 1.9.7 build).
On change-003 pass, release the HELD **change-005** (push + draft PR to fork `Know-Me-Tools/the-boss` `main`; never `v2`).
