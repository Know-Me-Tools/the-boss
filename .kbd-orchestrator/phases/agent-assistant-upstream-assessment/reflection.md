# KBD Reflection Report

Phase: `agent-assistant-upstream-assessment`
Reflector: `codex` via `kbd-process-orchestrator/skills/kbd-reflect`
Date: 2026-04-17T14:50:15Z
Status: complete with verification blockers

## Goal Achievement

The phase delivered the core stated objectives:

- `git@github.com:Prometheus-AGS/prometheus-skill-system.git` is added as a submodule at `resources/skills/prometheus-skill-system`.
- Built-in skill installation now recursively discovers nested skills in the Prometheus pack, installs them under stable built-in folder names, records source metadata, and fans them out to agents.
- Agent execution now runs through a runtime router instead of being hard-wired to Claude execution.
- Claude remains native Anthropic-compatible execution only; OpenAI/OpenAI-response/Vertex are no longer routed through the Claude runtime compatibility proxy.
- Codex, OpenCode, and UAR runtime adapters exist behind the same stream interface.
- Runtime configuration is stored in the existing extensible agent/session `configuration` JSON rather than adding a migration or new Redux state.
- Agent/session settings now include a Runtime tab, and the global Skills page shows Prometheus built-in pack status.
- The active assistant settings UI no longer exposes assistant-scoped skill override controls.

## Delivered Changes

### Skill System

The Prometheus submodule is under `resources/skills`, preserving the existing packaging behavior for resources. The installer now treats the submodule as a skill pack and installs nested `SKILL.md` directories instead of assuming every direct child of `resources/skills` is itself a skill.

The runtime preflight installs built-ins once, verifies required Prometheus defaults, enables required defaults across agents, and reconciles skill symlinks before execution. Test mode skips that preflight to avoid breaking unit tests that do not mock Electron app paths or the skills DB.

### Runtime Layer

The runtime router centralizes execution dispatch:

- `claude`: existing `ClaudeCodeService`.
- `codex`: `@openai/codex-sdk`.
- `opencode`: `@opencode-ai/sdk`, with managed or remote server mode.
- `uar`: remote/embedded endpoint using an OpenAI-compatible chat-completions surface.

All adapters return the existing `AgentStream` shape so current session streaming stays compatible.

### Claude Proxy Removal

`resolveClaudeCodeProviderRoute` now returns only `native_anthropic` for Anthropic-compatible providers. OpenAI/OpenAI-response/Vertex providers are rejected by Claude runtime with guidance to select Codex or OpenCode.

### Settings And UX

Runtime settings are available on agent and session settings. Runtime state is stored under `configuration.runtime`, avoiding new SQLite columns and avoiding blocked Redux root store expansion for this feature.

The Skills settings page shows Prometheus built-in pack status, installed default count, last reconciliation time from skill metadata timestamps, missing required default warnings, and a refresh action.

## Artifact Quality

Focused QA passed:

- Built-in skill installer and nested Prometheus pack discovery tests.
- Claude provider routing tests.
- Session knowledge tests after runtime preflight was isolated from unit tests.
- Assistant settings test updated to verify assistant-scoped skill settings are absent.
- `pnpm run typecheck:node`.
- `pnpm run typecheck:web`.
- `pnpm format`.

Full repo QA is blocked:

- `pnpm lint` fails on existing repo-wide React compiler rules and visible warnings from submodule scripts.
- `pnpm test` fails on existing Vitest 4 mock-constructor issues, Electron install validation, and unrelated snapshot drift.

## Technical Debt

- The runtime adapters normalize enough events for integration but still need deeper parity tests for tool approvals, MCP exposure, abort semantics, resume behavior, and long-running stream events.
- OpenCode managed server lifecycle should be revisited; closing the managed server after a single message is conservative but may not be the best UX for persistent sessions.
- UAR embedded sidecar packaging is not implemented yet; the adapter supports endpoint execution, but the sidecar build/sign/package hooks remain future work.
- Full removal of historical `skillConfig` Redux state is not completed; active assistant UI entry points were removed, but existing skill-selection services and tests still exist in the tree.
- The root lint command now sees submodule script warnings. The repo likely needs either an ignore boundary for vendored skill-pack sources or upstream cleanup inside the submodule.

## Lessons Learned

- Placing a full skill pack under `resources/skills` requires recursive discovery; direct-child assumptions break immediately because the Prometheus repository root is a pack, not an individual skill.
- The least disruptive runtime migration path is a router that preserves the current `AgentStream` contract.
- Runtime state belongs in the agents subsystem configuration JSON for now. This avoids adding migration pressure while the upstream journal already has ordering conflicts.
- Full-repo verification is currently not a reliable signal for this phase because the repo contains broad pre-existing lint/test incompatibilities.

## Next Recommendations

1. Add adapter-specific tests for Codex/OpenCode/UAR covering stream events, abort, resume, and provider mismatch errors.
2. Add a packaged-resource smoke test that verifies the Prometheus submodule is present and contains required KBD skills.
3. Decide whether vendored skill-pack sources should be excluded from root lint or cleaned upstream in the Prometheus skill repository.
4. Finish removing persisted assistant/topic `skillConfig` state after confirming no assistant-chat workflows still depend on it.
5. Implement UAR sidecar packaging under the existing `resources/binaries/<platform-arch>` pattern.
