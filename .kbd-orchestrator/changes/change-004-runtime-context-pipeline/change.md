# change-004-runtime-context-pipeline

Status: done
Phase: `multi-runtime-agent-parity-assessment`
Depends on: `change-001-runtime-agent-model`
Recommended agent: Codex
Complexity: L

## Goal

Replace text-only runtime handoff with a structured runtime context bundle.

## Scope

- `SessionMessageService`.
- Runtime router request contracts.
- Runtime adapters.
- Prompt assembly helpers.
- Tests for prompt composition and capability negotiation.

## Tasks

- [x] Define `PreparedAgentTurn` / `RuntimeContextBundle`.
- [x] Include canonical prompt text, runtime binding, model, workspace paths, attachments, resolved skills, knowledge references, and capability resolution results.
- [x] Update `SessionMessageService` to produce the structured bundle.
- [x] Preserve existing Claude behavior while adapting its execution path to the new contract.
- [x] Add prompt boundary markers and escaping for skills; knowledge remains wrapped by the existing citation/reference boundary prompt.
- [x] Replace the hard `skipSkillInjection` behavior with combination logic that allows skills and knowledge in the same turn.
- [x] Update runtime adapters to consume the structured bundle.
- [x] Add focused tests for skill plus knowledge composition.

## Verification

- [x] Claude execution receives equivalent prompt content as before unless runtime config changes.
- [x] Skills and knowledge can be present in the same turn.
- [x] Runtime adapters consume `AgentTurnInput` and extract prompt text from the structured bundle.

## Verification Results

- PASS: `pnpm vitest run src/main/services/agents/services/__tests__/SessionMessageService.knowledge.test.ts src/main/services/agents/services/runtime/__tests__/UarRuntimeAdapter.test.ts src/main/services/agents/services/runtime/__tests__/UniversalAgentRuntimeService.test.ts`
- PASS: `pnpm run typecheck:node`

## Constraints

- Keep prompt construction deterministic.
- Avoid broad unrelated refactors in chat/session services.
