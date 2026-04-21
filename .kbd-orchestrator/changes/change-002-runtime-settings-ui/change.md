# change-002-runtime-settings-ui

Status: done
Phase: `multi-runtime-agent-parity-assessment`
Depends on: `change-001-runtime-agent-model`
Recommended agent: Claude Code
Complexity: L

## Goal

Expose complete runtime configuration in settings UI for Claude, Codex, OpenCode, and UAR.

## Scope

- Agent settings runtime panel.
- IPC/preload/API wrappers for runtime profiles and health checks.
- i18n locale keys.
- Runtime compatibility warning UI.
- Tests for settings behavior.

## Tasks

- [x] Replace hardcoded runtime labels/descriptions with i18n-keyed labels and fallbacks.
- [x] Add profile inheritance vs per-agent override controls.
- [x] Add Claude runtime settings for permission mode and max turns; environment variables, compaction, tools, and MCP remain covered by existing adjacent agent settings panels.
- [x] Add Codex runtime settings for sandbox, approval policy, network access, reasoning effort, MCP, skills, and working directory/access-path configuration surfaces.
- [x] Add OpenCode runtime settings for managed/remote mode, base URL, auth, permissions, and skill-tool policy.
- [x] Add UAR runtime settings for embedded/remote mode, sidecar port, remote URL, auth, binary path, data paths, log level, and skill sync policy.
- [x] Add runtime test connection and health state controls.
- [x] Surface runtime capability and Claude-provider guidance in the runtime panel; deeper compatibility resolver wiring is deferred to runtime execution pipeline changes.
- [x] Add focused renderer tests for form mapping and validation.

## Verification

- [x] UI can configure every runtime kind through runtime-specific controls.
- [x] Per-agent overrides save through nested runtime configuration updates.
- [x] Runtime health/test action shows a visible saved/test-ready state.
- [x] i18n check passes.

## Verification Results

- PASS: `pnpm vitest run --project renderer src/renderer/src/pages/settings/AgentSettings/components/__tests__/RuntimeSettings.test.tsx`
- PASS: `pnpm run typecheck:web`
- PASS: `pnpm i18n:check`

## Constraints

- Do not add Redux slices.
- Do not use visible instructional copy where normal controls are sufficient.
- Keep settings changes consistent with existing Ant Design/styled-components patterns.
