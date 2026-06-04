# Tasks

- [x] Reconfirm assistant artifact card rendering from message block to `Markdown -> CodeBlock -> HtmlArtifactsCard/ReactArtifactsCard`.
- [x] Add or tighten assistant tests for HTML/HTMX and React code-fence artifact cards.
- [x] Add negative coverage proving plain code blocks and user-role messages do not expose artifact designer actions.
- [x] Reconfirm agent conversation output rendering through `AgentSessionMessages -> MessageGroup -> MainTextBlock -> Markdown`.
- [x] Add focused agent-session renderer coverage for assistant artifact content.
- [x] Add focused agent Read/Write tool coverage for artifact-like file outputs using `renderArtifactCard`.
- [x] Apply only shared-renderer fixes exposed by tests; do not duplicate agent-specific artifact card UI.
- [x] Run targeted renderer tests.
- [x] Run required repo checks: `pnpm lint`, `pnpm test`, and `pnpm format`.
