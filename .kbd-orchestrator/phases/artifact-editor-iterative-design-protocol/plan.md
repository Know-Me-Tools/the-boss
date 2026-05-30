# Plan — Artifact Editor: Iterative LLM Design Protocol

**Phase:** artifact-editor-iterative-design-protocol
**Date:** 2026-05-30
**Author:** Claude Code (kbd-plan)
**Backend:** native KBD change files (`.kbd-orchestrator/changes/*`)
**Inputs:** [assessment.md](./assessment.md) · [design.md](./design.md) · [progress.json](./progress.json)
**Base:** current 1.9.x line (per CLAUDE.md — never v2). Work on a feature branch off `main`.

## Backend decision

OpenSpec is **not** active here. `openspec/` exists but is empty scaffolding
(`openspec/changes/archive/` only, no `project.md`, no specs). The waypoint and
`progress.json` both record `openSpecDetected: false`, and all 28 prior changes in
this repo use native KBD change files. → **Use native KBD change files** for
consistency with the phase's recorded backend. No evolver (`.evolver/` absent) → no
bridge file.

## Strategy

Bottom-up, protocol-first. Build the **pure, testable spine** (types → reducer →
build seam → orchestrator) before any UI, then assemble the 3-pane designer on the
proven spine, then close the loop and finish create-path entry + docs. Every change
is TDD with two-stage review; pure changes (002, 003) must be unit-tested first.

Recommended feature branch: `feat/artifact-iterative-designer`.

## Ordered change list

| # | Change ID | Title | Depends on | Recommended agent |
|---|---|---|---|---|
| 1 | `change-001-artifact-design-protocol-types` | Renderer-local typed event union + version-hash anchor | — | tdd-guide → typescript-reviewer |
| 2 | `change-002-artifact-editor-reducer` | Pure editor state machine (idle→…→save) | 001 | tdd-guide → typescript-reviewer |
| 3 | `change-003-artifact-build-feedback-seam` | React compile + HTML validate → `build_status` | 001 | tdd-guide → typescript-reviewer |
| 4 | `change-004-artifact-design-orchestrator` | Renderer loop: structured-output turn → events | 001,002,003 | tdd-guide → code-reviewer |
| 5 | `change-005-artifact-designer-3pane` | Extend `ArtifactPopup` → chat│code│preview | 002,004 | tdd-guide → typescript-reviewer + a11y-architect |
| 6 | `change-006-designer-build-loop-wiring` | Close build-in-the-loop + save new version | 003,004,005 | tdd-guide → code-reviewer |
| 7 | `change-007-create-path-entry-and-docs` | "Iterate" entry from artifact cards + docs/i18n | 005,006 | code-reviewer → doc-updater |

### change-001 — artifact-design-protocol-types (P0, foundation)
**Goal:** Define the renderer-local `ArtifactDesignEvent` discriminated union (kinds
mirror `CanonicalAgentEvent`) and the version-hash anchor helper, in
`src/renderer/src/artifacts/` (new `designProtocol.ts` + types). Zod schema for the
structured-output payload the model returns (`{ source, language, notes? }`).
**Why first:** every other change consumes these types.
**Acceptance:** union + schema exported and unit-tested (valid/invalid payloads,
hash stability). No UI, no model calls.

### change-002 — artifact-editor-reducer (P0, pure)
**Goal:** Pure reducer implementing the state machine
(`idle→prompting→streaming→applying→building→preview→repair→saving→idle`, plus
`error`). Consumes `ArtifactDesignEvent`; records `versionHash` per source mutation;
rejects a turn whose `baseVersionHash` ≠ current head (stale-turn guard).
**Acceptance:** exhaustive reducer unit tests incl. stale-turn rejection, repair
loop re-entry, and error recovery. Pure — no React, no IPC.

### change-003 — artifact-build-feedback-seam (P0)
**Goal:** Thin renderer module that runs a build/validate pass and emits
`build_status`. React → `window.api.artifacts.compileReactArtifact` mapping
`{ diagnostics, errors }`. HTML → light validation (parse + sandboxed-load signal).
**Acceptance:** unit tests with mocked compile API for ok / diagnostics / errors;
HTML validate happy + malformed. No UI.

### change-004 — artifact-design-orchestrator (P1)
**Goal:** Renderer-orchestrated loop: take an NL request + current source, call the
chat model via structured output/tool (reuse existing model plumbing), and translate
the response stream into `ArtifactDesignEvent`s driving the reducer
(full-file-rewrite per turn). One turn = prompt → `artifact_full` → reducer applies →
003 builds → `build_status`.
**Acceptance:** orchestrator unit/integration test with a mocked model returning a
full file (and a failing build that triggers a repair turn). No UI yet.

### change-005 — artifact-designer-3pane (P1, UI)
**Goal:** Extend `ArtifactPopup` into a 3-pane designer (chat │ code │ preview)
behind a `mode="designer"` prop so the existing viewer/manual-editor usage is
unchanged. Chat pane submits requests to the 004 orchestrator; code pane = existing
CodeMirror; preview pane = existing iframe. i18n all strings; keyboard + focus order.
**Acceptance:** component tests (submit request → streaming → preview updates);
existing `ArtifactPopup.test.tsx` still green; a11y pass on the new pane.

### change-006 — designer-build-loop-wiring (P1)
**Goal:** Wire build-in-the-loop end to end: failed `build_status` surfaces in chat
and seeds the next turn ("edit again until functional"); accept → save a new
`ArtifactVersion` via `useArtifactLibrary`. Loading/error/repair states visible.
**Acceptance:** integration test: create → failing edit → repaired edit → preview →
save creates a new version; rollback/cancel leaves library untouched.

### change-007 — create-path-entry-and-docs (P2)
**Goal:** Add an "Iterate / Edit with AI" entry from `ReactArtifactsCard` /
`HtmlArtifactsCard` (via `renderArtifactCard`) opening the designer on the card's
source. Update `docs/` (artifacts guide) + i18n; verify the chat-code-block →
artifact-card → designer path end-to-end.
**Acceptance:** entry opens designer with correct source/language; docs updated;
`pnpm i18n:check` clean; manual end-to-end path verified.

## Cross-cutting constraints (CLAUDE.md)

- Build on 1.9.x; never use v2. Feature branch off `main`.
- Logging via `loggerService`; never `console.log`.
- All UI strings via i18next; run `pnpm i18n:check`.
- No new Redux slices / no Dexie schema change (none needed — artifact library
  persists via `window.api.artifacts`).
- Do not touch files bearing the DATA&UI REFACTORING freeze header (bug-fix only).
- Per-change completion gate: `pnpm lint && pnpm test` (+ `pnpm format`). Features
  without tests are not complete.
- PRs via the `gh-create-pr` skill; sign commits (`--signoff`); Conventional Commits.

## Milestones

- **M1 (spine):** changes 001–004 — protocol + reducer + build seam + orchestrator,
  all unit-tested, zero UI. The hard correctness work; de-risks the rest.
- **M2 (designer):** changes 005–006 — 3-pane designer + closed build loop + save.
- **M3 (entry + docs):** change 007 — discoverable from artifact cards, documented.

## Open items deferred to execution (not blocking)

- Exact structured-output mechanism (tool call vs response schema) — pick in 004 from
  the existing `packages/aiCore` tool/generate plumbing; keep it provider-agnostic.
- HTML "functional" validation depth — start with parse + load signal in 003; richer
  runtime checks are a follow-up.
