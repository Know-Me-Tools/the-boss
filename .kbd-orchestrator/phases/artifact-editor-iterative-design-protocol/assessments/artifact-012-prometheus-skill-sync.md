# Assessment - artifact-012-prometheus-skill-sync

Phase: artifact-editor-iterative-design-protocol
Date: 2026-06-04
Backend: OpenSpec
Change: openspec/changes/artifact-012-prometheus-skill-sync

## Scope

Assess whether the current repository fully wires the Prometheus skill system into the artifact editor workflow, including artifact-refiner skills, KBD process skills, source-of-truth references, sync/check scripts, runtime installation, and scope availability.

## Current Status

| Area | Status | Evidence |
| --- | --- | --- |
| Prometheus app resource submodule | Present | `.gitmodules` maps `resources/skills/prometheus-skill-system` to `git@github.com:Prometheus-AGS/prometheus-skill-system.git`. |
| Required artifact-refiner files | Present | `resources/skills/prometheus-skill-system/skills/imported/artifact-refiner/SKILL.md` and nested refine skills exist, including `refine-validate`. |
| Required KBD process files | Present | `resources/skills/prometheus-skill-system/skills/process/kbd-process-orchestrator/SKILL.md` and nested `kbd-assess`, `kbd-execute`, `kbd-init`, `kbd-plan`, `kbd-reflect`, and `kbd-status` skills exist. |
| Built-in nested skill discovery | Partial | `src/main/utils/builtinSkills.ts` recursively discovers nested `SKILL.md` files under `prometheus-skill-system` and installs them as built-ins, but test coverage only proves the root orchestrator and `kbd-execute`. |
| Artifact-refiner and sycophancy discovery tests | Missing | `src/main/__tests__/builtinSkills.test.ts` does not assert `artifact-refiner`, `refine-validate`, or imported `sycophancy-correction` built-in installation. |
| `skills:sync` / `skills:check` governance | Missing for Prometheus nested skills | `scripts/skills-sync.ts` and `scripts/skills-check.ts` only manage `.agents` public skills and `.claude` symlinks. They do not verify `resources/skills/prometheus-skill-system` or required nested Prometheus skills. |
| Source-of-truth reference alignment | Partial / divergent | `resources/skills/prometheus-skill-system` is at `893be5c`, while `vendor/universal-agent-runtime/crates/prometheus-skill-system` is at `cdd08c7`. Their artifact-refiner nested refs also differ: `55e8625` vs `3bc3fd9`. |
| Scope availability APIs | Partial | `SkillScopeService` supports global, assistant, topic, agent, and session scopes, and UI/runtime paths use scoped skill configs. Current tests do not prove Prometheus built-ins are selectable or available across assistant, agent, or session scopes. |
| Current flat skill check | Passes, narrow | `pnpm skills:check` passed and reported 7 public skills. That command does not cover the Prometheus nested skill requirements for this change. |

## Findings

The repository already contains the Prometheus skill-system resource and runtime code that can recursively discover nested built-in skills. The implementation should use that path instead of adding a second installer.

The incomplete part is governance and proof. The `skills:sync` and `skills:check` commands currently validate only the flat public skill mirror. They do not assert that the Prometheus resource exists, that required nested artifact-refiner and KBD skills exist, or that the application and UAR Prometheus references are intentionally aligned.

Submodule/reference drift is the main integration risk. The app resource Prometheus skill system and the vendored UAR embedded Prometheus skill system are on different commits, and the artifact-refiner refs differ as well. Planning should choose a source of truth and then update references consistently, or explicitly document why they should remain different.

Runtime scope plumbing exists, but the current tests do not close the request. Add tests proving installed Prometheus built-ins are discovered and can be listed/enabled through relevant scopes instead of assuming recursive discovery covers every workflow.

## Recommended Plan Direction

1. Define and document the Prometheus skill-system source of truth for this repository.
2. Align the app resource, vendored UAR Prometheus reference, and nested imported skill refs where appropriate.
3. Extend `skills:check` to validate required Prometheus nested skill paths: `artifact-refiner`, `artifact-refiner/refine-validate`, `sycophancy-correction`, KBD orchestrator, and all KBD subprocess skills.
4. Extend `skills:sync` only if sync has real source/target work to perform; otherwise keep it focused and make `skills:check` the enforcement gate.
5. Add built-in discovery tests that assert the required Prometheus nested skills install with stable sanitized folder names and source URLs.
6. Add scope availability tests for assistant and agent/session skill selection using existing `SkillScopeService` patterns.

## Constraints

Stay on the current 1.9.x codebase. Do not use or merge from `v2`. Do not add Redux slices or change IndexedDB/SQLite schema for this change. Keep changes focused to submodule/reference alignment, skill governance scripts, built-in discovery tests, and scoped availability tests.

## Validation Baseline

`PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" pnpm skills:check` passes today with `skills:check passed (7 public skills)`, but that result is insufficient for artifact-012 because it does not cover Prometheus nested skill availability.
