# Plan - artifact-012-prometheus-skill-sync

**Phase:** artifact-editor-iterative-design-protocol
**Change:** artifact-012-prometheus-skill-sync
**Date:** 2026-06-04
**Author:** Codex (kbd-plan)
**Backend:** OpenSpec
**Model class:** medium/frontier coding model
**Complexity:** M
**Customer value:** MEDIUM

## Goal

Normalize Prometheus skill-system references and add enough governance/runtime
proof that the artifact-refiner, KBD process skills, and shared supporting
skills are available to this project through the existing built-in skill system
and scoped skill selection paths.

## Current Inputs

- Assessment:
  `.kbd-orchestrator/phases/artifact-editor-iterative-design-protocol/assessments/artifact-012-prometheus-skill-sync.md`
- OpenSpec change:
  `openspec/changes/artifact-012-prometheus-skill-sync`
- Sycophancy audit:
  `.kbd-orchestrator/phases/artifact-editor-iterative-design-protocol/sycophancy/plan-artifact-012-prometheus-skill-sync-2026-06-04T11-28-35Z.json`
- Current skill check baseline: `pnpm skills:check` passes for 7 public
  skills, but does not cover Prometheus nested skills.

## Implementation Strategy

Use the existing packaged built-in skill path as the primary runtime path. The
app already discovers nested `SKILL.md` files under
`resources/skills/prometheus-skill-system` through
`src/main/utils/builtinSkills.ts`, so this change should strengthen reference
alignment, scripts, and tests around that path rather than adding a parallel
installer.

Treat `resources/skills/prometheus-skill-system` as the packaged application
source of truth unless execution discovers that the vendored UAR copy is the
canonical source for this fork. If refs diverge after audit, align them only
when the target commits are available and compatible; otherwise document the
intentional exception in the execution record.

## Ordered Tasks

1. Audit Prometheus references and record the source-of-truth decision.
   - Inspect `.gitmodules`, `resources/skills/prometheus-skill-system`, nested
     imported `artifact-refiner`/`sycophancy` refs,
     `vendor/universal-agent-runtime`, and
     `vendor/universal-agent-runtime/crates/prometheus-skill-system`.
   - Compare current commits and required `SKILL.md` inventories.
   - Decide whether to align app resource and UAR embedded Prometheus refs, or
     document why they remain different.

2. Update submodule/git refs where needed.
   - If the audit identifies a newer compatible Prometheus skill-system ref
     that contains all required artifact-refiner and KBD skills, update the
     relevant submodule pointers.
   - Keep updates scoped to skill-system utility refs, not unrelated UAR/runtime
     changes.
   - Record old/new refs in the execution log.

3. Add Prometheus nested skill governance to scripts.
   - Extend `scripts/skills-common.ts` with a required Prometheus nested skill
     manifest or exported path list.
   - Update `scripts/skills-check.ts` to validate the app resource path and
     required nested skills, including artifact-refiner root, `refine-validate`,
     imported `sycophancy-correction`, KBD orchestrator, and all KBD subprocess
     skills.
   - Update `scripts/skills-sync.ts` only if there is actual sync behavior to
     perform; otherwise leave sync focused on the existing public skill mirror
     and make check the enforcement gate.

4. Strengthen built-in discovery tests.
   - Extend `src/main/__tests__/builtinSkills.test.ts` so Prometheus nested
     discovery covers artifact-refiner, `refine-validate`,
     `sycophancy-correction`, `kbd-assess`, `kbd-plan`, `kbd-execute`,
     `kbd-reflect`, and `kbd-status`.
   - Assert stable sanitized folder names and `sourceUrl` values where
     practical.
   - Preserve the existing recursive discovery implementation unless tests
     expose a defect.

5. Add scoped availability regression coverage.
   - Add a focused `SkillScopeService` test proving Prometheus built-ins can be
     listed and enabled through global plus assistant and agent/session-style
     scope resolution.
   - Use existing repository patterns; do not alter scope schema, Redux slices,
     Dexie schema, or SQLite schema.

6. Update OpenSpec tasks and execution record.
   - Mark artifact-012 OpenSpec tasks as complete during execution once each
     task is verified.
   - Add a refiner/QA record if the changed file count reaches the local
     threshold used by the prior artifact changes.

7. Validate.
   - Run targeted tests first: skills check, built-in skill tests, and any new
     scoped availability tests.
   - Run `openspec validate artifact-012-prometheus-skill-sync --strict`.
   - Run `pnpm lint`.
   - Run `pnpm test`.
   - Run `pnpm format`.

## Risks And Decisions

- **Submodule updates:** Updating refs may require network access and may expose
  unrelated upstream changes. Execution should prefer narrow pointer alignment
  and document any intentionally deferred ref if alignment would pull unrelated
  runtime changes.
- **Installer drift:** The existing runtime installer already has recursive
  nested discovery. Duplicating installer logic would raise drift risk, so the
  plan focuses on tests and governance scripts.
- **Sync semantics:** `skills:sync` may remain unchanged if there is no real sync
  target for Prometheus nested skills. Enforcement can live in `skills:check`
  without adding fake sync behavior.
- **State and schema:** No Redux or database schema changes are planned.

## Execution Recommendation

Use `dependency-auditor -> code-reviewer` with Codex performing the focused code
changes, submodule/ref inspection, and tests on the existing 1.9.x codebase.

## Next Command

```sh
/kbd-execute artifact-012-prometheus-skill-sync
```
