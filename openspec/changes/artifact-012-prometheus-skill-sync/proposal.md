# artifact-012-prometheus-skill-sync

## Purpose

Normalize Prometheus skill-system references and verify all required skills,
including artifact-refiner and KBD process skills, are available to this project.

## Scope

- Audit `resources/skills/prometheus-skill-system` and embedded related references.
- Resolve the intended single source of truth for skill-system commits.
- Update submodule/git references only as needed for the requested workflow.
- Ensure `skills:sync` and `skills:check` cover nested artifact-refiner/KBD/shared skills.
- Add tests for built-in discovery and scope availability.

## Out of Scope

- Unrelated skill-pack rewrites.
- Moving the repository to `v2`.

## Success Criteria

- Prometheus KBD process skills and artifact-refiner skills are discoverable.
- Nested skill discovery tests cover the required directories.
- Skill sync/check passes.
- Any changed submodule references are documented in the plan/execution record.
