# change-008-runtime-chat-telemetry

Status: done
Phase: `multi-runtime-agent-parity-assessment`
Depends on: `change-004-runtime-context-pipeline`
Recommended agent: Claude Code
Complexity: M

## Goal

Show runtime information, health, status, approvals, and errors in the chat interface.

## Scope

- Renderer stream chunk parsing.
- Message block types.
- Chat message block rendering.
- Runtime status UI strings.
- Tests for chunk and block behavior.

## Tasks

- [x] Add typed runtime event chunk definitions.
- [x] Add runtime message block types for status/info/error/approval events.
- [x] Update stream processing to normalize runtime events from Claude, Codex, OpenCode, and UAR.
- [x] Render runtime badge, mode, model/provider, session id, sidecar health, skill sync, and readable errors.
- [x] Add approval UI plumbing for runtime approval events where applicable.
- [x] Hide or collapse low-value raw runtime event JSON behind an explicit debug view.
- [x] Add renderer tests for runtime chunk conversion and block rendering.

## Verification

- [x] Chat displays which runtime handled the turn.
- [x] Runtime errors are readable and actionable.
- [x] Approval/status events do not break existing text/tool/skill blocks.

## Implementation Notes

- Added `ChunkType.RUNTIME_EVENT` and normalized `data-agent-runtime-*` stream parts into renderer runtime chunks.
- Added `MessageBlockType.RUNTIME` with accumulated runtime events and approval metadata.
- Added runtime stream callbacks that create one runtime block per assistant message and append later status/tool/approval/usage events.
- Added `RuntimeBlock` rendering with runtime identity, session id, metadata chips, approval buttons, readable error text, and collapsed debug payload.

## Verification Results

- `pnpm vitest run --project renderer src/renderer/src/aiCore/chunk/__tests__/AiSdkToChunkAdapter.contextManagement.test.ts src/renderer/src/services/__tests__/StreamProcessingService.test.ts src/renderer/src/services/messageStreaming/callbacks/__tests__/runtimeCallbacks.test.ts src/renderer/src/pages/home/Messages/Blocks/__tests__/RuntimeBlock.test.tsx` passed.
- `pnpm run typecheck:web` passed.
- `pnpm i18n:check` passed.

## Constraints

- Do not add explanatory marketing-style copy inside chat.
- Preserve existing message block rendering for Claude conversations.
