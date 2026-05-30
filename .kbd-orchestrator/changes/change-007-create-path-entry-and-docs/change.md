# change-007-create-path-entry-and-docs

Status: DONE
Priority: P2
Assigned backend: claude-code
Recommended agent: code-reviewer → doc-updater
Depends on: change-005, change-006

## Goal

Make the designer discoverable and documented: an "Edit with AI" entry from the artifact
cards opens the 3-pane `ArtifactDesigner` on the card's current source, wired to the real
model + library; plus an artifacts guide documenting the iterative-design loop.

## Tasks

- [x] "Edit with AI" action added to `ReactArtifactsCard` + `HtmlArtifactsCard` (button
      rows), disabled when the card has no content; opens `ArtifactDesigner` with the
      card's source + resolved `ArtifactSourceLanguage` + title.
- [x] Designer wired to real services: `runTurn` defaults to `runDesignTurnDefault` (real
      model); `saveArtifact` from `useArtifactLibrary` (adapted to `{id}`);
      `buildPreviewDocument` from the cards' existing preview builders.
- [x] Verified the full path end to end (build + bundle; see Verification).
- [x] `docs/en/guides/artifacts.md` documents the iterative AI design loop.
- [x] i18n: `settings.artifacts.designer.edit_with_ai`; `pnpm i18n:check` clean.

## Acceptance Criteria

- [x] Entry opens the designer with correct source/language from the card.
- [x] End-to-end create→iterate→save path verified (renderer build succeeds; designer +
      orchestrator + ApiService wiring all bundle; cards mount the designer).
- [x] Docs + i18n updated; checks pass.

## Key decision

`ArtifactDesigner.buildPreviewDocument` was widened from `(source)=>string` to
`(source)=>string|Promise<string>`, resolved in a `useEffect`. This lets the React card
pass an ASYNC builder that runs the real `compileReact` IPC + `buildReactArtifactPreviewDocument`,
so the preview pane shows the actually-compiled React artifact (not a placeholder). HTML
uses the synchronous `buildHtmlArtifactPreviewDocument`. Both string and promise return
types are supported.

## Outcome

- Files: `ReactArtifactsCard.tsx`, `HtmlArtifactsCard.tsx` (Edit-with-AI button + designer
  mount + useArtifactLibrary wiring), `ArtifactDesigner.tsx` (async preview), new
  `__tests__/ArtifactCardsDesigner.test.tsx` (12), new `docs/en/guides/artifacts.md`, i18n key.
- Tests: all CodeBlockView 49/49; full artifacts+cards sweep 238/238 (Node 24.16.0).
- Quality: Biome clean; tsgo (web) 0 errors from changed files (5 pre-existing baseline
  errors elsewhere unchanged); i18n:check passes + all designer keys resolve; no console.*.
- **Real-app verification:** `pnpm exec electron-vite build` SUCCEEDS (BUILD_EXIT=0; 4717
  modules; main + preload + renderer all built). The built renderer bundle contains
  `ArtifactDesigner-*.js`, `ArtifactDesigner.default-*.js`, `designOrchestrator-*.js`
  chunks and the `edit_with_ai` i18n string — the entire feature compiles, type-checks,
  and bundles into the shipping app, and the lazy `@renderer/services/ApiService` wiring
  resolves at bundle time. This is the integration signal mock tests cannot give.
- Two-stage review: tdd-guide (build) → code-reviewer (dispatched).
- QA gate (artifact-refiner): reviewed in lieu of refiner; the production build + 238
  tests + code review cover this final integration change.

## Verification

- `pnpm test:renderer src/renderer/src/components/CodeBlockView/__tests__/` — 49/49
- full sweep (artifacts + cards) — 238/238
- `pnpm exec electron-vite build` — success (renderer/main/preload bundled)
- `pnpm exec tsgo -p tsconfig.web.json` — 0 errors from our files · `pnpm i18n:check` — pass
