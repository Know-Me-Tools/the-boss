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
`progress.json` both record `openSpecDetected: false`, and all prior changes in
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

### change-001 — artifact-design-protocol-types (P0, foundation) — DONE
Renderer-local `ArtifactDesignEvent` union (kinds mirror `CanonicalAgentEvent`),
the structured-output `ArtifactDesignTurnPayloadSchema`, and a pure `versionHash`
anchor. Consumed by every later change. **Status: DONE** (27/27 tests).

### change-002 — artifact-editor-reducer (P0, pure)
Pure reducer (`idle→prompting→streaming→applying→building→preview→repair→saving→idle`
+ `error`). Consumes `ArtifactDesignEvent`; records `versionHash` per mutation;
rejects a turn whose `baseVersionHash` ≠ current head (stale-turn guard).

### change-003 — artifact-build-feedback-seam (P0)
Thin renderer module: React → `compileReactArtifact` mapping `{ diagnostics, errors }`;
HTML → light validation. Emits `build_status`. IPC injected/mockable.

### change-004 — artifact-design-orchestrator (P1)
Renderer loop: NL request + current source → chat model via structured output/tool →
translate into `ArtifactDesignEvent`s driving the reducer (full-file rewrite per turn);
one turn = prompt → `artifact_full` → reducer applies → 003 builds → `build_status`.

### change-005 — artifact-designer-3pane (P1, UI)
Extend `ArtifactPopup` into 3 panes behind `mode="designer"` (existing viewer
untouched). Chat pane → orchestrator; code pane = CodeMirror; preview = iframe. i18n +
a11y.

### change-006 — designer-build-loop-wiring (P1)
Failed `build_status` surfaces + seeds next turn; accept → save new `ArtifactVersion`
via `useArtifactLibrary`; cancel leaves library untouched.

### change-007 — create-path-entry-and-docs (P2)
"Edit with AI" entry from artifact cards opening the designer; docs + i18n; verify
end-to-end create→iterate→save.

## Cross-cutting constraints (CLAUDE.md)

- Build on 1.9.x; never use v2. Feature branch off `main`.
- Logging via `loggerService`; never `console.log`. All UI strings via i18next.
- No new Redux slices / no Dexie schema change.
- Per-change completion gate: `pnpm lint && pnpm test` (+ `pnpm format`); Node >=24.11.1.
- PRs via the `gh-create-pr` skill; sign commits (`--signoff`); Conventional Commits.

## Milestones

- **M1 (spine):** changes 001–004 — protocol + reducer + build seam + orchestrator,
  unit-tested, zero UI. (001 DONE.)
- **M2 (designer):** changes 005–006 — 3-pane designer + closed build loop + save.
- **M3 (entry + docs):** change 007.
