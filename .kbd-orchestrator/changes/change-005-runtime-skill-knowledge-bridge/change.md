# change-005-runtime-skill-knowledge-bridge

Status: done
Phase: `multi-runtime-agent-parity-assessment`
Depends on: `change-001-runtime-agent-model`, `change-004-runtime-context-pipeline`
Recommended agent: Codex
Complexity: L

## Goal

Map the app's skills and knowledge bases into each runtime without duplicating sources of truth.

## Scope

- Skill service/runtime bridge.
- Runtime-specific filesystem/config generation.
- UAR skill sync.
- Runtime skill sync state persistence.
- Tests for sync and prompt behavior.

## Tasks

- [x] Keep the app skill registry as canonical.
- [x] Preserve Claude `.claude/skills` installation through existing `SkillService.reconcileAgentSkills`.
- [x] Add Codex skill bridge using generated `.codex/skills` files.
- [x] Add OpenCode `.opencode/skills` and `.opencode/agents` generation instead of relying only on Claude compatibility.
- [x] Add UAR skill sync using generated `.uar/skills` files and `.uar/skills.json` discovery manifest.
- [x] Track runtime skill sync status, checksum/version, external id/path, and last error through `agent_runtime_skill_syncs`.
- [x] Keep knowledge retrieval app-side for this phase.
- [x] Add tests for runtime-specific generated files and combined skill/knowledge prompt injection.

## Verification

- [x] Enabling a skill for an agent produces the correct runtime-native representation for each selected runtime.
- [x] UAR receives or discovers the selected skill list through `.uar/skills.json`.
- [x] Knowledge references remain available across all runtimes through the structured context bundle.
- [x] Sync failures are visible and do not corrupt canonical skill records.

## Verification Results

- PASS: `pnpm vitest run src/main/services/agents/services/runtime/__tests__/RuntimeSkillBridgeService.test.ts src/main/services/agents/services/__tests__/SessionMessageService.knowledge.test.ts`
- PASS: `pnpm run typecheck:node`

## Constraints

- Do not make runtime copies the source of truth.
- Avoid double-injecting skills when a runtime can use native skills.
