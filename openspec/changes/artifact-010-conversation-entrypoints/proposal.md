# artifact-010-conversation-entrypoints

## Purpose

Ensure artifact editing can be launched from both assistant conversations and
agent conversations, with consistent behavior for HTML/HTMX and React artifacts.

## Scope

- Verify assistant conversation artifact cards still open `ArtifactDesigner`.
- Find the agent conversation rendering path and add the same artifact editor entry if missing.
- Keep non-artifact code blocks unchanged.
- Add regression tests for assistant and agent rendering paths where feasible.

## Success Criteria

- Assistant-rendered HTML/HTMX artifacts expose Edit with AI.
- Assistant-rendered React artifacts expose Edit with AI.
- Agent-rendered artifact outputs expose Edit with AI through the relevant renderer path.
- Plain code blocks do not show artifact editing controls.
