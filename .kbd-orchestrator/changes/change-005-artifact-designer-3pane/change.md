# change-005-artifact-designer-3pane

Status: TODO
Priority: P1
Assigned backend: claude-code (subagent-driven TDD)
Recommended agent: tdd-guide → typescript-reviewer + a11y-architect
Depends on: change-002, change-004
Phase: artifact-editor-iterative-design-protocol

## Goal

Extend `ArtifactPopup` into a 3-pane designer (chat │ code │ preview) behind a
`mode="designer"` prop, so existing viewer / manual-editor usage is untouched. The chat
pane submits NL requests to the change-004 orchestrator; the code pane reuses the existing
CodeMirror editor; the preview pane reuses the existing iframe.

## Tasks

- [ ] Add a chat/prompt pane to `ArtifactPopup.tsx` gated by `mode="designer"`.
- [ ] Bind reducer state (change-002) to panes: streaming → code, build ok → preview,
      build fail → chat surface.
- [ ] i18n all new strings (`pnpm i18n:check` clean).
- [ ] Keyboard navigation + focus order across the 3 panes; ARIA labels.
- [ ] Component tests: submit request → streaming → preview updates. Keep existing
      `ArtifactPopup.test.tsx` green.

## Acceptance Criteria

- [ ] Existing `ArtifactPopup` viewer/editor behavior unchanged (default mode).
- [ ] Designer mode renders 3 panes and reacts to reducer state.
- [ ] a11y pass on the new pane; no hardcoded UI strings.

## Verification

- `pnpm test:renderer src/renderer/src/components/CodeBlockView/__tests__/ArtifactPopup.test.tsx`
- `pnpm i18n:check`
- `pnpm lint`
