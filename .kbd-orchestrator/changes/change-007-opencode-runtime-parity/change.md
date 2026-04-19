# change-007-opencode-runtime-parity

Status: done
Phase: `multi-runtime-agent-parity-assessment`
Depends on: `change-004-runtime-context-pipeline`, `change-005-runtime-skill-knowledge-bridge`
Recommended agent: Codex
Complexity: M

## Goal

Make OpenCode runtime execution configurable, observable, and compatible with the canonical agent model.

## Scope

- `OpenCodeRuntimeAdapter`.
- Managed OpenCode server lifecycle.
- Remote OpenCode server client.
- OpenCode agent/skill config generation.
- Permission and event handling.
- Tests/mocks for OpenCode execution.

## Tasks

- [x] Replace per-turn managed server startup/shutdown with a controlled lifecycle appropriate for sessions/workspaces.
- [x] Support remote OpenCode server URL and auth settings.
- [x] Generate or sync `.opencode/agents` and `.opencode/skills`.
- [x] Map canonical model/provider, permissions, tools, and skills into OpenCode config.
- [x] Persist/resume OpenCode session ids through runtime session binding.
- [x] Normalize OpenCode events into runtime/chat event types.
- [x] Add permission response integration where OpenCode asks for approval.
- [x] Add tests for managed and remote config resolution.

## Verification

- [x] Managed OpenCode sessions can execute more than one turn without unnecessary server churn.
- [x] Remote OpenCode mode can be health-checked and used.
- [x] Generated agent/skill files match the selected agent definition.
- [x] Permission and runtime events are surfaced through normalized chunks.

## Verification Results

- `pnpm vitest run src/main/services/agents/services/runtime/__tests__/OpenCodeRuntimeAdapter.test.ts` passed.
- `pnpm vitest run src/main/services/agents/services/runtime/__tests__/OpenCodeRuntimeAdapter.test.ts src/main/services/agents/services/runtime/__tests__/CodexRuntimeAdapter.test.ts src/main/services/agents/services/runtime/__tests__/RuntimeSkillBridgeService.test.ts` passed.
- `pnpm run typecheck:node` passed.

## Constraints

- Do not rely on Claude compatibility as the only OpenCode skill path.
- Ensure managed server cleanup still happens on app shutdown.
