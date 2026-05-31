# Execution — Artifact Editor: Iterative LLM Design Protocol

**Phase:** artifact-editor-iterative-design-protocol
**Date:** 2026-05-30
**Author:** Claude Code (kbd-execute)
**Inputs:** [assessment.md](./assessment.md) · [design.md](./design.md) · [plan.md](./plan.md)

## Backend selection

**Backend: `native-tool` (claude-code, subagent-driven TDD).**

| Candidate | Verdict |
|---|---|
| `openspec` | Rejected — `openspec/` is empty scaffolding; phase backend is native KBD (`openSpecDetected: false`). |
| `native-tool` (claude-code) | **Selected** — explicit per-change planning (7 native change files), inspectable `progress.json`, TDD renderer/TS code driven by claude-code subagents (tdd-guide + two-stage review). |
| `hybrid` | Rejected — no spec-execution layer to gain from OpenSpec. |
| `manual` | Rejected — fully automatable. |

## Dispatch contract

- **Source of truth:** `.kbd-orchestrator/`. `progress.json` tracks change status;
  `change-NNN/change.md` holds the per-change task checklist.
- **Branch:** `feat/artifact-iterative-designer` off `main` (1.9.x line; never v2).
- **Per-change loop:** tdd-guide (RED→GREEN→REFACTOR) → two-stage review (recommended
  agent per change) → gate `pnpm lint && pnpm test` (Node >=24.11.1) → mark `DONE` →
  artifact-refiner QA gate (unless <3 files / docs-only / `--skip-qa`) → archive on PASS.
- **PRs:** via `gh-create-pr`; commits `--signoff`, Conventional Commits.

## Environment note (resumed session)

The default shell Node is v20.18.1 but the repo requires **>=24.11.1**. Use
`nvm use 24` (v24.16.0 available) or `fnm use 24` before `pnpm test`/`lint`/`format`.
Biome and tsgo run fine under either.

## Build order

- **M1 spine:** change-001 (DONE) → 002 → 003 → 004 (unit-tested, zero UI).
- **M2 designer:** change-005 → 006.
- **M3 entry+docs:** change-007.

## Progress

- **change-001 — protocol types: DONE.** `src/renderer/src/artifacts/designProtocol.ts`
  + test. 27/27 tests (Node 24), Biome clean, no `console.*`, tsgo clean. Two-stage
  review (tdd-guide → typescript-reviewer) applied: HIGH `readonly` on `build_status`,
  LOW named-type for `language`, LOW pinned-hash test, MEDIUM doc notes. QA gate
  skipped (2 files < 3-file threshold).
- **Next:** change-002-artifact-editor-reducer.

## QA constraints

See [.kbd-orchestrator/constraints.md](../../constraints.md) — the artifact-refiner
QA gate reads it.
