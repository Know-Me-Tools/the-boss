PLAN: multi-runtime-agent-parity-assessment
Project: The Boss / Cherry Studio fork
Date: 2026-04-17T23:41:44Z
OpenSpec available: NO
Changes to implement: 4

## Scope

This plan implements only the remaining gaps from the runtime functionality assessment. No broad refactors, no new runtime concepts, no unrelated UX cleanup.

## Change List

1. `change-010-runtime-control-plane`: Wire runtime profiles, effective config, and health/test control plane
   - Scope: db | main IPC | preload types | renderer settings | tests
   - Depends on: NONE
   - Recommended agent: Codex
   - Est. complexity: M
   - Customer value: HIGH
   - Details: Expose agent runtime profile/settings APIs through main IPC and preload, merge global settings plus profile plus agent/session overrides into the effective runtime config, and make the settings health/test button call real backend checks. UAR embedded health must verify binary presence and sidecar readiness instead of setting local UI text.

2. `change-011-runtime-session-bindings`: Persist runtime-specific session ids
   - Scope: db repository | session message service | runtime adapters | tests
   - Depends on: `change-010-runtime-control-plane`
   - Recommended agent: Codex
   - Est. complexity: M
   - Customer value: HIGH
   - Details: Use `agent_runtime_session_bindings` as the source of truth for runtime session ids keyed by app session id and runtime kind. Stop sharing one legacy `agent_session_id` across runtimes so switching Claude/Codex/OpenCode/UAR cannot resume the wrong backend thread.

3. `change-012-runtime-approval-response-flow`: Complete runtime approval responses
   - Scope: main runtime adapters | IPC/preload | renderer runtime block | tests
   - Depends on: `change-011-runtime-session-bindings`
   - Recommended agent: Codex
   - Est. complexity: M
   - Customer value: HIGH
   - Details: Add a typed runtime approval response bridge and wire `RuntimeBlock` approval buttons to it. OpenCode permission events must be actionable where the SDK exposes a response surface; unsupported runtimes must report a clear unsupported response instead of showing dead buttons.

4. `change-013-uar-electron-smoke`: Prove embedded UAR runs from the Electron app path
   - Scope: test | docs | scripts if needed
   - Depends on: `change-010-runtime-control-plane`, `change-011-runtime-session-bindings`, `change-012-runtime-approval-response-flow`
   - Recommended agent: Codex
   - Est. complexity: M
   - Customer value: HIGH
   - Details: Add a focused smoke test or harness that starts UAR through the same main-process service used by Electron, verifies `/healthz` and `/readyz`, sends a chat request through the app adapter path, observes runtime telemetry, and stops the sidecar. This is the gate for claiming embedded UAR runs inside the app.

## Execution Round Order

Round 1: `change-010-runtime-control-plane`
Round 2: `change-011-runtime-session-bindings`
Round 3: `change-012-runtime-approval-response-flow`
Round 4: `change-013-uar-electron-smoke`

## Commands To Run

Native KBD changes:

```bash
sed -n '1,220p' .kbd-orchestrator/changes/change-010-runtime-control-plane/change.md
```

Required final gates:

```bash
pnpm format
pnpm lint
pnpm test
pnpm uar:build:sidecar
```

## Sycophancy Self-Check

PASS. The plan does not claim the runtimes are fully functional yet. It cuts scope to the four missing capabilities that block the user's stated goal: real runtime control plane, runtime-specific session binding, approval responses, and embedded UAR proof from the Electron app path.

PLAN COMPLETE
