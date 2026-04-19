# Assistant Skill Scope Foundation Plan

## Summary

Restore assistant access to skills without making blocked Redux assistant/topic state the source of truth. Skills become a shared capability across assistants, topics, agents, and sessions through a DB-backed skill-scope layer, so assistant conversations can later be converted into Universal Agent Runtime agents with their skill choices intact.

## Change Units

- `change-001-kbd-state`: Create KBD execution/progress/reflection artifacts for this phase.
- `change-002-schema-migration`: Add `skill_scopes` schema and append migration journal entry after the current tail.
- `change-003-scope-service`: Add `SkillScopeService` and repository support for global, assistant, topic, agent, and session skill config scopes.
- `change-004-ipc-preload`: Expose `skillScope` IPC/preload APIs and shared scope types.
- `change-005-skill-loaders`: Make renderer and main installed-skill descriptor loading scope-aware.
- `change-006-assistant-ux`: Restore Assistant Settings skill UI and make Conversation Settings write topic scopes through `skillScope`.
- `change-007-chat-agent-injection`: Wire assistant chat and agent runtime message paths to resolved skill scopes.
- `change-008-conversion-helper`: Add a pure assistant-to-agent draft helper with origin metadata.
- `change-009-tests-verification`: Add targeted tests and run verification commands.

## Acceptance Criteria

- Assistant Settings has a Skills tab backed by `skill_scopes(assistant, assistantId)`.
- Conversation Settings writes topic skill overrides to `skill_scopes(topic, topicId)`.
- Assistant chat injects selected scoped skills.
- Agent runtime skill injection uses `global -> agent -> session` scope resolution.
- Existing `agent_skills` workspace symlink behavior remains intact.
- No new persisted Redux assistant/topic skill writes are introduced.
