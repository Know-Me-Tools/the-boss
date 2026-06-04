# KBD Execution - MiniMax Agent Protocol

**Phase:** minimax-agent-protocol
**Date:** 2026-06-03
**Author:** Codex (kbd-execute)
**Selected backend:** manual + hybrid OpenSpec/KBD tracking
**Reason:** The remaining work is install/live smoke validation with a real MiniMax key. OpenSpec change files exist for traceability, but the next gates require interactive app install and runtime proof.

## Backend Selection

| Signal | Value |
|---|---|
| OpenSpec available | yes, root `openspec/` exists |
| Existing KBD progress | yes, `.kbd-orchestrator/phases/minimax-agent-protocol/progress.json` |
| Remaining changes | 4 of 5 |
| Automation possible | partial only |
| Final proof requires user/API key | yes |

Selected execution mode: **manual/hybrid**. KBD remains the source of truth; OpenSpec tasks mirror the ordered change list.

## Dispatch State

### change 1 of 5 - `minimax-001-verify-fix-in-source`

Status: DONE.

Evidence from progress:

- Runtime suite 137/137.
- Typecheck clean.
- Biome clean.
- Only negative test assertion contains `protocol: "auto"`.

Artifact-refiner QA: skipped. Verification-only change with no new output artifacts in this execution pass and fewer than 3 newly modified implementation files.

### change 2 of 5 - `minimax-002-install-1.9.7-build`

Status: DISPATCHED / WAITING FOR INTERACTIVE INSTALL PROOF.

Actions performed by this execute run:

- Verified artifacts exist:
  - `dist/The-Boss-1.9.7-arm64.dmg`
  - `dist/The-Boss-1.9.7-arm64.zip`
  - `dist/The-Boss-1.9.7-arm64.zip.blockmap`
- Ran:

```sh
open dist/The-Boss-1.9.7-arm64.dmg
```

- Confirmed the DMG mounted at `/Volumes/The Boss 1.9.7-arm64`.
- Confirmed mounted app metadata:
  - `CFBundleShortVersionString = 1.9.7`
  - `CFBundleVersion = 1.9.7`
  - `CFBundleIdentifier = tools.know-me.the-boss`
  - signature is ad-hoc with hardened runtime flags.

Pending manual tasks:

- Install/copy `The Boss.app` from the mounted DMG to the intended Applications location.
- Launch the installed app.
- Confirm the running app reports `1.9.7`.

Do not mark this change done until the running installed app is confirmed.

### change 3 of 5 - `minimax-003-live-smoke-minimax-agent`

Status: PENDING. Gate: change 2 done.

Dispatch contract:

- Configure built-in MiniMax standard/global provider with a real key.
- Start an Agent conversation using a MiniMax model.
- Confirm normal streamed response.
- Confirm generated protocol is `chat`.
- Confirm no `/v1/responses` or `wss://api.minimax.io/v1/responses` request.

### change 4 of 5 - `minimax-004-regression-responses-providers`

Status: PENDING. Gate: change 3 pass.

Dispatch contract:

- Verify OpenAI or xAI agent models still resolve to `responses`.
- Verify normal non-agent MiniMax assistant chat still works.

### change 5 of 5 - `minimax-005-push-and-open-draft-pr`

Status: HELD. Gate: change 3 pass, or explicit user override.

Dispatch contract:

- Push branch.
- Use `gh-create-pr` skill.
- Target `Know-Me-Tools/the-boss` `main`.
- Do not use `v2`.
- Open as draft with smoke-test evidence.

## Exact Next Human Step

Install the mounted app:

```sh
open "/Volumes/The Boss 1.9.7-arm64"
```

Then drag `The Boss.app` into the intended Applications folder, launch it, and confirm it reports version `1.9.7`.

## Notes

- This execution run intentionally did not mark change 2 complete. Mounted-app metadata is not the same as installed-running-app proof.
- KBD hooks were not available under `.kbd-orchestrator/shared/lib`, so `execute:before` was skipped.
- Per-task hooks belong to `/kbd-apply`, not this `/kbd-execute` dispatch.
