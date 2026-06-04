# KBD Plan - MiniMax Agent Protocol

**Phase:** minimax-agent-protocol
**Date:** 2026-06-03
**Author:** Codex (kbd-plan)
**Backend selected by kbd-plan:** OpenSpec, because `openspec/` exists at the project root.
**Compatibility note:** This phase already had native KBD change files. They are preserved, and matching OpenSpec change structures were added for this planning run.
**Branch:** `fix/minimax-agent-protocol-chat`
**Base rule:** Stay on current 1.9.x. Do not use `v2`.

## Goal

Prove that the fixed 1.9.7 build routes MiniMax Agent conversations through Chat Completions (`protocol: "chat"`) instead of the nonexistent MiniMax Responses endpoint (`/v1/responses`), then ship the branch through a draft PR.

## Current Status

- Source fix is already present and verified.
- `pnpm build:mac:arm64` completed on 2026-06-03 using ad-hoc signing because two local Apple Development identities share the same display name.
- Artifacts exist:
  - `dist/The-Boss-1.9.7-arm64.dmg`
  - `dist/The-Boss-1.9.7-arm64.zip`
  - `dist/The-Boss-1.9.7-arm64.zip.blockmap`
- Remaining work is delivery and live proof with a real MiniMax key, not new source work unless smoke testing finds another route emitting `auto`.

## Ordered Change List

| Order | Change ID | Title | Type | Owner / Agent | Status | OpenSpec command |
|---|---|---|---|---|---|---|
| 1 | `minimax-001-verify-fix-in-source` | Re-verify fix in source | verify | build-error-resolver if red | done | `/opsx:new minimax-001-verify-fix-in-source` |
| 2 | `minimax-002-install-1.9.7-build` | Install the 1.9.7 build | delivery | manual/user | pending | `/opsx:new minimax-002-install-1.9.7-build` |
| 3 | `minimax-003-live-smoke-minimax-agent` | Live smoke: MiniMax Agent conversation | verify | user / e2e-runner assist | pending | `/opsx:new minimax-003-live-smoke-minimax-agent` |
| 4 | `minimax-004-regression-responses-providers` | Regression: responses providers and MiniMax chat | verify | user / e2e-runner assist | pending | `/opsx:new minimax-004-regression-responses-providers` |
| 5 | `minimax-005-push-and-open-draft-pr` | Push branch and open draft PR | delivery | gh-create-pr | held until change-003 passes | `/opsx:new minimax-005-push-and-open-draft-pr` |

## Change Details

### minimax-001-verify-fix-in-source

Reconfirm the source generator no longer emits `protocol: "auto"` for MiniMax and that runtime tests still pass.

Tasks:

- [x] Run runtime protocol tests.
- [x] Run node typecheck for touched runtime files.
- [x] Run formatter/linter checks for touched runtime files.
- [x] Grep source/packages for live `protocol: "auto"` literals.

Done gate: source remains green; only the negative test assertion contains `protocol: "auto"`.

### minimax-002-install-1.9.7-build

Install the build artifact that contains the source fix.

Tasks:

- [ ] Open `dist/The-Boss-1.9.7-arm64.dmg`.
- [ ] Drag/install `The Boss.app` into `/Applications` or the desired test install path.
- [ ] If needed, bypass Gatekeeper with right-click Open or remove quarantine.
- [ ] Launch the app and confirm the UI reports version `1.9.7`.

Done gate: the running app is confirmed to be 1.9.7, not the stale 1.9.4 install.

### minimax-003-live-smoke-minimax-agent

Run the real user-visible proof against the built-in MiniMax standard provider.

Tasks:

- [ ] Configure the built-in MiniMax standard/global provider with a real key.
- [ ] Start an Agent conversation using a MiniMax model.
- [ ] Send a simple prompt and observe a normal streamed reply.
- [ ] Confirm generated UAR/liter-llm config uses `protocol: "chat"`.
- [ ] Confirm no request targets `wss://api.minimax.io/v1/responses` or `/v1/responses`.

Done gate: MiniMax Agent conversation streams normally through Chat Completions.

### minimax-004-regression-responses-providers

Verify the protocol resolver did not break providers that intentionally support Responses.

Tasks:

- [ ] Verify OpenAI or xAI agent models still resolve to `responses` where expected.
- [ ] Verify normal non-agent MiniMax assistant chat still works.
- [ ] Capture failures with provider id, endpoint, model id, endpoint type, and generated protocol.

Done gate: responses-capable providers still use Responses, and non-agent MiniMax chat still works.

### minimax-005-push-and-open-draft-pr

Publish the branch only after the live MiniMax smoke test passes or the user explicitly overrides the gate.

Tasks:

- [ ] Push `fix/minimax-agent-protocol-chat`.
- [ ] Use the `gh-create-pr` skill.
- [ ] Target `Know-Me-Tools/the-boss` `main`; do not target `v2`.
- [ ] Open as a draft PR.
- [ ] Fill PR template with source verification, live smoke evidence, and any known signing/build notes.

Done gate: draft PR exists, points at 1.9.x `main`, and includes smoke-test evidence.

## Exact Next Step

```sh
open dist/The-Boss-1.9.7-arm64.dmg
```

Then install and confirm the app reports `1.9.7`; after that, run the MiniMax Agent live smoke test.

## Risks

- Stale install risk: testing `/Applications/travisjames.ai/The Boss.app` or any 1.9.4 bundle will reproduce the old failure.
- Signing risk: the local mac arm64 build was ad-hoc signed due duplicate Apple Development identities. This is fine for smoke testing but should be called out for distribution.
- Live-key risk: change-003 requires a real MiniMax key; without it the phase cannot be fully closed.

## No Evolver Bridge

No `.evolver/` plan was found, so no `evolver-bridge.json` was created.
