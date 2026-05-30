# Execution — Artifact Editor: Iterative LLM Design Protocol

**Phase:** artifact-editor-iterative-design-protocol
**Date:** 2026-05-30
**Author:** Claude Code (kbd-execute)
**Inputs:** [assessment.md](./assessment.md) · [design.md](./design.md) · [plan.md](./plan.md)

## Backend selection

**Backend: `native-tool` (claude-code, subagent-driven TDD).**

| Candidate | Verdict |
|---|---|
| `openspec` | Rejected — `openspec/` is empty scaffolding (no `project.md`, no specs); the phase's recorded backend is native KBD (`openSpecDetected: false`), consistent with all 28 prior changes. |
| `native-tool` (claude-code) | **Selected** — explicit per-change planning exists (7 native change files), inspectable progress via `progress.json`, and the work is TDD renderer/TS code best driven by claude-code subagents (tdd-guide + two-stage review). |
| `hybrid` | Rejected — no spec-execution layer to gain from OpenSpec. |
| `manual` | Rejected — fully automatable. |

## Dispatch contract

- **Source of truth:** `.kbd-orchestrator/` (this repo). `progress.json` tracks change
  status; `change-NNN/change.md` holds the task checklist per change.
- **Branch:** `feat/artifact-iterative-designer` off `main` (1.9.x line; never v2).
  KBD planning artifacts committed separately on `docs/artifact-editor-assessment`.
- **Per-change loop:** for each change in `change_order`:
  1. tdd-guide: write failing tests (RED) → minimal impl (GREEN) → refactor.
  2. Two-stage review: the change's recommended agent (typescript-reviewer /
     code-reviewer / + a11y-architect for UI).
  3. Completion gate: `pnpm lint && pnpm test` (+ `pnpm format`).
  4. Mark change `DONE` in `progress.json`.
  5. QA gate (artifact-refiner) per the skill, unless skip criteria apply
     (<3 files / docs-only / `--skip-qa`).
  6. Archive on PASS → `.kbd-orchestrator/changes/archive/<date>-<id>/`.
- **PRs:** via `gh-create-pr` skill; commits `--signoff`, Conventional Commits.

## Build order (from plan)

- **M1 spine:** change-001 → 002 → 003 → 004 (unit-tested, zero UI).
- **M2 designer:** change-005 → 006.
- **M3 entry+docs:** change-007.

## This run (scope, user-approved 2026-05-30)

Set up the dispatch contract + branch, then implement **change-001** fully
(protocol types + version-hash anchor) via TDD with two-stage review and the QA gate.
Remaining changes (002–007) execute in subsequent runs from this contract.

## QA constraints

See [.kbd-orchestrator/constraints.md](../../constraints.md) — the artifact-refiner
QA gate reads it. Captures CLAUDE.md rules (loggerService, i18n, no new Redux/Dexie
schema, 1.9.x base, freeze-header files bug-fix-only, tests required).
