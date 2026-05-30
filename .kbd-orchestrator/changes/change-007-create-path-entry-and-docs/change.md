# change-007-create-path-entry-and-docs

Status: TODO
Priority: P2
Assigned backend: claude-code
Recommended agent: code-reviewer → doc-updater
Depends on: change-005, change-006
Phase: artifact-editor-iterative-design-protocol

## Goal

Make the designer discoverable and documented. Add an "Iterate / Edit with AI" entry
from the artifact cards that opens the 3-pane designer on the card's current source, and
document the iterative-design flow.

## Tasks

- [ ] Add an "Edit with AI" action to `ReactArtifactsCard` / `HtmlArtifactsCard`
      (through `renderArtifactCard`) opening `ArtifactPopup` in `mode="designer"` with the
      card's source + resolved `ArtifactSourceLanguage`.
- [ ] Verify the full path: chat code block → artifact card → designer → edit → save.
- [ ] Update `docs/` artifacts guide with the iterative-design loop.
- [ ] i18n new strings; `pnpm i18n:check` clean.

## Acceptance Criteria

- [ ] Entry opens the designer with correct source/language from the card.
- [ ] End-to-end create→iterate→save path verified.
- [ ] Docs + i18n updated and checks pass.

## Verification

- `pnpm test:renderer`
- `pnpm i18n:check`
- `pnpm lint`
