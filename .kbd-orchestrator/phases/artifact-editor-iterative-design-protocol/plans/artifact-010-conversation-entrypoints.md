# Plan — artifact-010-conversation-entrypoints

**Phase:** artifact-editor-iterative-design-protocol
**Change:** artifact-010-conversation-entrypoints
**Date:** 2026-06-03
**Author:** Codex (kbd-plan)
**Backend:** OpenSpec
**Assessment:** `.kbd-orchestrator/phases/artifact-editor-iterative-design-protocol/assessments/artifact-010-conversation-entrypoints.md`
**OpenSpec:** `openspec/changes/artifact-010-conversation-entrypoints`

## Backend Decision

Use the existing OpenSpec change record. Root `openspec/` is present and the
waypoint records `changeBackend: "openspec"`. No `.evolver/` plan was found, so
no evolver bridge is needed.

## Plan Summary

PLAN: artifact-010-conversation-entrypoints
Project: The Boss / Cherry Studio fork
Date: 2026-06-03
OpenSpec available: YES
Changes to implement: 1

## Change List

1. `artifact-010-conversation-entrypoints`: Verify and lock assistant plus agent conversation artifact designer entrypoints
   - Scope: ui | renderer tests | agent-session rendering tests
   - Depends on: `artifact-009-library-designer-entry`
   - Recommended agent: Codex
   - Est. complexity: M
   - Complexity score: Medium
   - Model class: medium
   - Customer value: HIGH
   - Details: Trace and test assistant code-fence artifacts, agent-session assistant messages, and file-backed agent Read/Write outputs so HTML/HTMX and React artifacts surface Edit with AI through the shared cards. Keep product edits minimal; only adjust routing if tests expose a broken path. Preserve plain code-block and user-message behavior.

## Ordered Implementation Plan

| # | Task | Files | Notes |
| --- | --- | --- | --- |
| 1 | Reconfirm assistant artifact rendering boundary | `src/renderer/src/pages/home/Markdown/CodeBlock.tsx`, `src/renderer/src/pages/home/Markdown/__tests__/CodeBlock.test.tsx` | Add or tighten assertions for HTML/HTMX and React fences reaching artifact cards with designer entry enabled. |
| 2 | Add assistant negative coverage | `CodeBlock.test.tsx` or `Markdown.test.tsx` | Prove normal non-artifact code fences fall back to `CodeBlockView` and do not expose artifact editing controls. |
| 3 | Add agent-session conversation coverage | `src/renderer/src/pages/agents/components/AgentSessionMessages.tsx`, new/updated agent component test | Mock session/message hooks and assert assistant message content reaches the shared `MessageGroup -> MainTextBlock -> Markdown` artifact-card path. |
| 4 | Add agent tool output coverage | `src/renderer/src/pages/home/Messages/Tools/__tests__/MessageAgentTools.test.tsx` or focused Read/Write tests | Verify `ReadTool` and `WriteTool` use `renderArtifactCard` for `.html`, `.htm`, `.svg`, `.tsx`, and `.jsx` file hints where practical. |
| 5 | Apply only fixes proven necessary by tests | Existing renderer path files only if a gap is found | Do not duplicate artifact card UI. If a route is broken, normalize into `renderArtifactCard` or the shared Markdown artifact path. |
| 6 | Run targeted renderer tests | Relevant renderer test files | Run focused tests before full repo checks. |
| 7 | Run required repo checks | repo root | `pnpm lint`, `pnpm test`, and `pnpm format` under Node >=24.11.1. |

## Risks and Trade-offs

- The assessment shows the main routes are already wired, so this plan deliberately treats `artifact-010` as verification-first. The visible product delta may be small unless tests expose a real gap.
- Full support for future structured agent artifact events is deferred. Adding that now would broaden scope beyond the current evidence; if such an event path is found during execution, normalize it into `renderArtifactCard`.
- `AgentSessionMessages` is integration-heavy, so tests may need focused mocks around message hooks and stream subscriptions rather than a full live agent runtime.

## Test Plan

- Assistant HTML/HTMX code fence renders the HTML artifact card path with Edit with AI available.
- Assistant React/TSX code fence renders the React artifact card path with Edit with AI available.
- Plain code fences and user-role messages do not surface artifact designer actions.
- Agent session assistant messages reuse the shared message rendering path.
- Agent Read/Write tool outputs render artifact cards for artifact-like file paths and fall back to code viewer for non-artifact paths.

## Execution Round Order

Round 1 (parallel): `artifact-010-conversation-entrypoints`

## Commands to Run

```sh
/kbd-execute artifact-010-conversation-entrypoints
```

## Constraints

- Do not add Redux slices.
- Do not change Dexie, SQLite, or artifact library schema.
- Keep all user-visible labels in i18next.
- Use shared artifact components instead of duplicating agent-specific artifact UI.
- Stay on the current 1.9.x base; do not use `v2`.

## Completion Criteria

- OpenSpec tasks for `artifact-010-conversation-entrypoints` are checked off.
- `progress.json` marks `artifact-010-conversation-entrypoints` as `DONE`.
- Required checks pass: `pnpm lint`, `pnpm test`, and `pnpm format`.
- If more than three product files are changed, artifact-refiner QA is recorded.

PLAN COMPLETE
