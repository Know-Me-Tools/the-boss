# change-006-codex-runtime-parity

Status: done
Phase: `multi-runtime-agent-parity-assessment`
Depends on: `change-004-runtime-context-pipeline`, `change-005-runtime-skill-knowledge-bridge`
Recommended agent: Codex
Complexity: M

## Goal

Make Codex runtime execution configurable, observable, and compatible with the canonical agent model.

## Scope

- `CodexRuntimeAdapter`.
- Codex runtime config mapping.
- Runtime event emission.
- Tests/mocks for Codex execution.

## Tasks

- [x] Map canonical agent instructions to Codex thread/custom-agent execution.
- [x] Map sandbox, approval policy, network access, reasoning effort, model, MCP, and skill config.
- [x] Preserve/resume Codex thread ids through runtime session binding.
- [x] Emit normalized runtime events instead of only raw `data-agent-runtime-event` payloads.
- [x] Add compatibility warnings or blocking for unsupported providers/settings.
- [x] Add approval handling contract if Codex requires user approval callbacks.
- [x] Add tests around config mapping and stream event normalization.

## Verification

- [x] Codex runtime can execute an agent with configured sandbox and model settings.
- [x] Runtime session id is persisted and reused where intended.
- [x] Unsupported config is visible as a compatibility warning or execution error before unsafe invocation.

## Verification Results

- `pnpm vitest run src/main/services/agents/services/runtime/__tests__/CodexRuntimeAdapter.test.ts` passed.
- `pnpm vitest run src/main/services/agents/services/runtime/__tests__/CodexRuntimeAdapter.test.ts src/main/services/agents/services/runtime/__tests__/runtimeModel.test.ts` passed.
- `pnpm run typecheck:node` passed.

## Constraints

- Do not silently degrade permission or sandbox settings.
- Do not assume non-OpenAI providers work through Codex unless verified.
