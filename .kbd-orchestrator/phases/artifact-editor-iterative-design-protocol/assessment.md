ASSESSMENT: artifact-editor-iterative-design-protocol

Project: The Boss / Cherry Studio fork
Date: 2026-06-03
Codebase baseline: A v1 artifact designer exists for chat-rendered HTML/HTMX and React artifacts, but product-level stored-artifact editing, first-class navigation, mini-app/library editing, and complete Prometheus skill-system availability are still partial.
Cross-tool progress: 7 artifact v1 changes recorded as DONE by claude-code; 2026-06-03 Codex reassessment recorded a broader productization gap.

## IMPLEMENTATION STATUS

- Chat artifact detection and cards: **DONE** — shared artifact parsing recognizes React and HTML/HTMX aliases; `ReactArtifactsCard` and `HtmlArtifactsCard` expose preview, copy, open/download, and Edit with AI entries.
- Iterative designer core: **PARTIAL** — `ArtifactDesigner` supports chat/code/preview, multiple model turns, repair loop, build feedback, and a save seam. The code pane is explicitly read-only in v1, save bypasses `artifact_saved` reducer events, and designer saves create new records rather than updating existing stored artifacts.
- Artifact storage service: **PARTIAL** — `ArtifactService` can save/list/get/fork/delete records and compile React artifacts through IPC. There is no source update or append-version API, so stored-artifact refinement cannot preserve version history as a managed edit workflow.
- Artifact library management UI: **PARTIAL** — settings library lists/searches/filters/opens/copies/forks/renames/deletes artifacts. It opens `ArtifactPopup`, not `ArtifactDesigner`, and manual preview save only updates local preview state rather than persisting a source version.
- Assistant conversation entry: **PARTIAL** — normal code-block artifact cards expose Edit with AI, but live assistant end-to-end create-refine-store proof was not rerun in this assessment.
- Agent conversation entry: **MISSING/PARTIAL** — no evidence that agent-session message rendering has a separate verified path exposing `ArtifactDesigner` from agent outputs.
- Left navigation: **MISSING** — sidebar icon union and default icon list do not contain an artifact/library route; artifacts are only under settings.
- Mini-app/library surface: **MISSING** — minapp infrastructure exists, but no artifact library/editor mini-app is registered.
- Artifact settings/database: **PARTIAL** — artifact settings schema and JSON-backed library exist, but no database-backed source-version update API or designer behavior settings are present.
- i18n labels: **PARTIAL** — some artifact/designer keys exist, but artifact settings service-access copy still contains hardcoded English and new route/mini-app/version labels are missing.
- Prometheus skill-system submodules: **PARTIAL** — `resources/skills/prometheus-skill-system` is present with 32 skills and nested artifact-refiner/sycophancy submodules; UAR also embeds another skill-system at a different commit. Source-of-truth and update policy are not resolved.
- Skill availability in app: **PARTIAL** — built-in skill discovery has tests for nested Prometheus skills and settings expose skill scopes, but this assessment did not verify that every Prometheus skill is installed, synced, enabled, and selectable in global/assistant/agent/session scopes at runtime.

## CROSS-TOOL PROGRESS

- `change-001-artifact-design-protocol-types`: DONE (by claude-code) — typed renderer-local artifact design events and version hash.
- `change-002-artifact-editor-reducer`: DONE (by claude-code) — editor state machine.
- `change-003-artifact-build-feedback-seam`: DONE (by claude-code) — React compile/HTML validation feedback.
- `change-004-artifact-design-orchestrator`: DONE (by claude-code) — structured-output model turn to events.
- `change-005-artifact-designer-3pane`: DONE (by claude-code) — 3-pane designer UI.
- `change-006-designer-build-loop-wiring`: DONE (by claude-code) — repair/build/save loop.
- `change-007-create-path-entry-and-docs`: DONE (by claude-code) — Edit with AI entry from chat cards and docs.
- `reassessment_2026_06_03`: DONE (by codex) — identified follow-on productization/integration gaps.

## SPEC GAP SUMMARY

- Stored artifact versioning: Missing append/update source API and UI to manage versions.
- Library-to-designer workflow: Missing Edit with AI from stored library rows and mini-app/library surfaces.
- Agent message integration: Not proven for agent conversations; may need separate renderer wiring.
- First-class navigation: Missing `/artifacts` route and sidebar icon configuration.
- Mini-app editing: Missing artifact mini-app registration or route-backed mini-app behavior.
- Skill-system integration: Submodules exist, but full runtime availability and single source of truth are not verified.
- Settings/i18n: Missing route/mini-app/version/designer defaults and hardcoded artifact settings text remains.

## BUILD HEALTH

- build check: **UNKNOWN** — no build/test/lint command was run in this assess pass.
- known violations: active worktree contains unrelated dirty artifact/runtime files; no new implementation edits were made in this pass.
- test coverage: **PARTIAL** — prior artifact v1 has broad unit coverage; the missing productization surfaces have no tests yet.

## CONSTRAINT CHECK

- AGENTS.md violations: **NONE from this assessment pass**; no Redux or DB schema changes were made. Future implementation must not add Redux slices or database schema changes without explicit approval.
- constraints.md violations: **UNKNOWN** — not evaluated beyond repo conventions; no code edits were made.

## GOAL PROGRESS

- Create HTML/HTMX artifact: **PARTIAL** — rendering/detection exists; live end-to-end proof not rerun.
- Create React artifact: **PARTIAL** — rendering/compile path exists; live end-to-end proof not rerun.
- Decide to edit and open editor from assistant conversation: **PARTIAL** — card-level Edit with AI exists for normal artifact cards.
- Open editor from agent conversation: **NOT MET** — not verified or separately wired.
- Multiple turns refining artifact: **PARTIAL** — designer supports multiple turns and repair loop, but stored artifact update workflow is incomplete.
- Store/manage refined artifact: **PARTIAL** — can create new library records, but cannot update existing stored source versions.
- Left navigation entry: **NOT MET** — no first-class artifact sidebar route.
- Mini-app/library editing: **NOT MET** — no artifact mini-app/editor from library.
- Settings/database/language files: **PARTIAL** — existing settings/schema/i18n are incomplete for requested workflow.
- Update Prometheus skill-system submodule/git references and make all skills available: **PARTIAL** — submodules and scripts exist; full sync/scoping availability is not verified.

## SYCOPHANCY REVIEW

Sycophancy detector score: `0.01785714365541935`. One low-severity S-07 note flagged length; no correction was mandatory. Audit saved at `.kbd-orchestrator/phases/artifact-editor-iterative-design-protocol/sycophancy/assess-2026-06-03T18-03-22Z.json`.

ASSESSMENT COMPLETE
