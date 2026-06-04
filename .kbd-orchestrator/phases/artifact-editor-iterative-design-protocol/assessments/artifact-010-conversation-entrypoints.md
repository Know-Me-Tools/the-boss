# Assessment — artifact-010-conversation-entrypoints

**Phase:** artifact-editor-iterative-design-protocol
**Change:** artifact-010-conversation-entrypoints
**Date:** 2026-06-03
**Author:** Codex (kbd-assess)
**Backend:** OpenSpec

## Scope

Assess whether HTML/HTMX and React artifacts can be launched into the iterative
artifact designer from both normal assistant conversations and agent session
conversations, and identify the remaining work for the OpenSpec change.

## Current Status

| Requirement | Status | Evidence |
| --- | --- | --- |
| Assistant HTML/HTMX code fences render artifact cards | MET | `Markdown -> CodeBlock` resolves HTML/HTMX descriptors and returns `HtmlArtifactsCard`. |
| Assistant React/TSX code fences render artifact cards | MET | `Markdown -> CodeBlock` resolves React descriptors and returns `ReactArtifactsCard`. |
| Assistant artifact cards expose Edit with AI | MET | `HtmlArtifactsCard` and `ReactArtifactsCard` include the designer action and focused card tests. |
| Agent session assistant text uses the same render path | MET | `AgentSessionMessages` renders `MessageGroup`; `MainTextBlock` renders assistant content through `Markdown` with artifact cards enabled. |
| Agent streamed responses use the shared block pipeline | MET | `setupChannelStream` feeds chunks through `AiSdkToChunkAdapter`, `BlockManager`, and standard message blocks. |
| Agent Read/Write tool outputs expose artifact cards for artifact files | MET | `ReadTool` and `WriteTool` call `renderArtifactCard` using file path hints and source content. |
| Agent-specific conversation regression tests | PARTIAL | Shared `CodeBlock` and card tests exist, but no focused `AgentSessionMessages`/agent tool regression locks the conversation entrypoint. |
| Plain code blocks avoid artifact actions | PARTIAL | `CodeBlock` falls back to `CodeBlockView` when no artifact descriptor is resolved; explicit regression coverage should be added for agent sessions. |

## Dependencies Already Satisfied

- `ArtifactDesigner` is already wired into `HtmlArtifactsCard` and `ReactArtifactsCard`.
- `renderArtifactCard` centralizes artifact descriptor resolution for file-backed agent tool outputs.
- `MainTextBlock` gates artifact cards to assistant-role content, so user messages do not gain artifact edit actions.
- `artifact-009-library-designer-entry` confirmed stored-library edit/save behavior separately.

## Implementation Gaps

1. Add focused assistant conversation tests that assert HTML/HTMX and React fences surface the Edit with AI action through `Markdown` or `CodeBlock`.
2. Add agent session renderer coverage proving an assistant message in `AgentSessionMessages` reaches the shared artifact-card path.
3. Add agent Read/Write tool regression coverage for `.html`, `.htm`, `.svg`, `.tsx`, and `.jsx` file hints where practical.
4. Add negative coverage for non-artifact code blocks and user-role messages so artifact actions remain scoped to assistant artifact content.
5. If a future agent runtime emits structured artifact events instead of markdown/tool file content, normalize that event into `renderArtifactCard` rather than creating another card implementation.

## Constraints

- Do not add Redux slices.
- Do not change Dexie, SQLite, or artifact library schema.
- Keep user-visible labels in i18next.
- Use shared artifact components instead of duplicating agent-specific artifact UI.
- Stay on the current 1.9.x base; do not use `v2`.

## Recommended Execution Notes

- This change should be test-heavy and light on product code unless a coverage gap exposes a broken path.
- Prefer testing the shared renderer boundaries:
  - `CodeBlock`/`Markdown` for assistant code-fence artifacts.
  - `AgentSessionMessages` with mocked message data for agent-session conversation rendering.
  - `ReadTool`/`WriteTool` for file-backed agent outputs.
- Keep `allowArtifactCards={role === 'assistant'}` intact unless the user explicitly wants user-authored drafts to expose artifact designer actions.

## Build Health

No build, lint, format, or test command was run in this assessment pass. The previous completed change (`artifact-009`) passed targeted renderer tests, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm format`.

ASSESSMENT COMPLETE
