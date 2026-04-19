# change-001-runtime-agent-model

Status: done
Phase: `multi-runtime-agent-parity-assessment`
Depends on: NONE
Recommended agent: Codex
Complexity: L

## Goal

Make the persisted agent model runtime-agnostic while preserving existing Claude-compatible data.

## Scope

- Agent and session TypeScript schemas.
- SQLite/Drizzle schema and migrations for runtime profiles, runtime settings, runtime session bindings, and runtime skill sync references.
- Main-process repositories/services for runtime profile CRUD.
- Compatibility resolver and runtime capability matrix.
- Backward compatibility for legacy `claude-code` rows.

## Tasks

- [x] Expand or decouple `AgentTypeSchema` so runtime is not encoded as only `claude-code`.
- [x] Add discriminated runtime config schemas for `claude`, `codex`, `opencode`, and `uar`.
- [x] Add a persisted runtime profile/settings model with per-agent overrides.
- [x] Add runtime session binding storage for runtime-specific thread/session ids.
- [x] Add runtime skill sync storage or a migration-ready table shape used by later changes.
- [x] Implement a `RuntimeCapabilityMatrix` and compatibility resolver.
- [x] Preserve existing agents and sessions through migration/backfill defaults.
- [x] Add focused tests for schema parsing, migration defaults, and compatibility resolution.

## Verification

- [x] Targeted schema/repository tests pass.
- [x] Existing Claude agent rows continue to load as Claude runtime bindings.
- [x] Runtime compatibility warnings can be produced without invoking a runtime.

## Constraints

- Do not change renderer Redux store shape.
- Do not modify IndexedDB schema.
- Route logging through `loggerService`.
