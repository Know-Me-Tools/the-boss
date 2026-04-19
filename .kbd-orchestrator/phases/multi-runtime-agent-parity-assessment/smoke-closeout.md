# Runtime Phase Smoke Closeout

Project: The Boss / Cherry Studio fork
Date: 2026-04-18T15:16:00Z
Branch: `main`
Commit at review start: `15f44f902`
Status: recorded, not staged

## Scope

This closeout reviewed the broad runtime phase diff and ran best-effort live runtime smoke probes using `docs/en/guides/agent-runtimes.md`.

No product scope was added. Native KBD change files under `.kbd-orchestrator/changes/change-001...change-013` were kept in place as the branch audit trail. Non-fatal lint-warning cleanup was not performed.

## Diff Review

Commands inspected:

- `git diff --stat`
- `git status --short`
- `git diff --name-status`
- `git ls-files --others --exclude-standard`
- targeted diffs for schema/migrations, IPC/preload, runtime services/adapters, UI, tests, docs, vendored UAR, and lint/package config
- `git submodule status --recursive`
- guardrail search for accidental `v2`, Redux slice, and IndexedDB/Dexie schema changes

Findings:

- Broad tracked diff at review time: 121 tracked files, roughly 3,115 insertions and 1,123 deletions, plus untracked KBD/runtime/docs/schema/vendor artifacts.
- Branch policy guardrail held: no checkout, merge, rebase, cherry-pick, or base work on `v2`. `v2` text hits were policy/documentation references.
- No new Redux slice was found. Store diffs were limited to existing runtime/skill usage and one existing provider URL migration adjustment.
- No Dexie/IndexedDB schema change was found.
- Drizzle migrations are intentional:
  - `resources/database/drizzle/0008_skill_scopes.sql`
  - `resources/database/drizzle/0009_agent_runtime_model.sql`
  - matching schema files under `src/main/services/agents/database/schema/`
- IPC/preload expansion is intentional for runtime control and approval responses.
- Runtime service/adapters are intentional under `src/main/services/agents/services/runtime/`.
- Runtime UI/tests/docs are intentional, including `RuntimeSettings.tsx`, `RuntimeBlock.tsx`, runtime adapter tests, and `docs/en/guides/agent-runtimes.md`.
- Vendored UAR state is intentional:
  - `.gitmodules` includes `vendor/universal-agent-runtime`
  - UAR submodule is pinned at `c7c8416...`
  - sidecar metadata at `resources/binaries/darwin-arm64/.uar-version` expects the same UAR commit
  - AGPL/build metadata exists under `resources/licenses/universal-agent-runtime/`
- Lint/package config changes are intentional:
  - `biome.jsonc` excludes vendored code
  - `eslint.config.mjs` excludes generated/vendor skill resources and relaxes current React compiler checks
  - `package.json` adds runtime SDK/build dependencies and `uar:build:sidecar`

Suspicious or out-of-scope diff items:

- None found during diff review.

Index note:

- This closeout did not stage any files.
- `git diff --cached --stat` showed pre-existing staged submodule metadata entries for `.gitmodules`, `resources/skills/prometheus-skill-system`, and `vendor/universal-agent-runtime`.
- Those staged entries were left untouched.

## Baseline Gates

Previously recorded green gates for this phase remain the baseline:

- `pnpm format`
- `pnpm lint`
- `pnpm test`
- `pnpm uar:build:sidecar`
- `git diff --check`

This closeout did not make product code changes. Full gates were not rerun during smoke closeout.

## Live App Smoke

Attempted command:

```bash
pnpm debug
```

First attempt result:

- The app build completed, but Electron failed before runtime smoke could start.
- Error: `Electron failed to install correctly, please delete node_modules/electron and try installing again`
- Local node_modules repair was performed with:
  - `node node_modules/electron/install.js`
  - `pnpm exec electron --version`
- Electron then reported `v41.2.1`.

Second attempt result:

- `pnpm debug` reached application startup.
- CDP port `9222` appeared briefly, then closed.
- `agent-browser connect 9222` failed with connection refused.
- `curl http://127.0.0.1:9222/json/version` failed with connection refused.
- The renderer dev URL was not usable after the app exited.

Relevant log excerpt:

```text
[builtinSkills] Failed to sync built-in skill to DB {
  folderName: 'prometheus-skill-system__skills__process__kbd-process-orchestrator__skills__kbd-plan',
  error: 'Failed query: select "id", "name", "description", "folder_name", "source", "source_url", "namespace", "author", "tags", "content_hash", "is_enabled", "created_at", "updated_at" from "skills" where "skills"."id" = ? limit ?\nparams: ,1'
}
```

Isolated HOME retry:

```bash
HOME=/tmp/cherry-runtime-closeout-home pnpm debug
```

Result:

- Same class of startup failure.
- Built-in skill sync attempts for Prometheus KBD and iterative-evolver skill folders failed with an empty skill id query parameter.
- App exited before browser automation or runtime UI actions could run.

Blocker:

- Live Claude, Codex, OpenCode, and in-app UAR UI smoke tests are blocked by app startup exit during built-in skill DB sync.
- Suspected owner scope: built-in skill import/sync and skill metadata parsing for vendored Prometheus skills.
- Staging impact: blocks the requested real runtime UI smoke evidence until resolved or explicitly waived.

## Runtime Smoke Matrix

| Runtime | Requested smoke | Result | Blocker status |
|---|---|---|---|
| Claude managed | Tool-using, skill-enabled prompt, text output, tool blocks, skill context, resume | Not reached because app exits during startup | Blocked by app startup |
| Codex managed | OpenAI-compatible model, telemetry, sandbox/approval metadata, session id, tool events, token usage | Not reached because app exits during startup | Blocked by app startup |
| OpenCode managed | Two turns, managed server reuse, persisted session id, approval UI | Not reached because app exits during startup | Blocked by app startup |
| OpenCode remote | Real compatible endpoint | No endpoint was available in this environment | Runtime-specific unavailable blocker |
| UAR embedded via app | Sidecar launch, `/v1/models`, streamed chat response, telemetry, cleanup | Not reached in app because app exits during startup | Blocked by app startup |
| UAR embedded direct sidecar | Packaged binary launch, HTTP bind, `/healthz`, `/v1/models`, streamed chat | Binary starts but does not bind HTTP port in manual probes | Runtime-specific blocker |
| UAR remote | Real compatible endpoint | No endpoint was available in this environment | Runtime-specific unavailable blocker |

## UAR Direct Sidecar Evidence

CLI usage works:

```bash
resources/binaries/darwin-arm64/universal-agent-runtime --help
```

The binary exposes:

- `--config`
- `--port`
- `--llm-model`
- `--llm-api-key`
- `/v1/models` and `/v1/chat/completions` are documented in vendored server routes

Manual probe 1:

```bash
cd /tmp/cherry-uar-closeout
LLM_API_KEY="$OPENAI_API_KEY" UAR_SERVER__LOG_FORMAT=compact \
  resources/binaries/darwin-arm64/universal-agent-runtime \
  --config vendor/universal-agent-runtime/config.embedded.yaml \
  --port 19061
```

Result:

- Process stayed alive.
- No listener appeared on `127.0.0.1:19061`.
- Log excerpt:

```text
Failed to initialize VectorMatcher: Tokenizer file not found at any of these paths:
src/uar/runtime/matching/models/tokenizer.json, /app/models/tokenizer.json,
src/uar/runtime/matching/models/tokenizer.json, ./src/uar/runtime/matching/models/tokenizer.json
```

Manual probe 2:

```bash
cd vendor/universal-agent-runtime
LLM_API_KEY="$OPENAI_API_KEY" UAR_SERVER__LOG_FORMAT=compact \
  resources/binaries/darwin-arm64/universal-agent-runtime \
  --config /tmp/cherry-uar-closeout/config.embedded.yaml \
  --port 19061
```

Result:

- Process stayed alive.
- No listener appeared on `127.0.0.1:19061`.
- Vendored `mcp.json` was picked up and printed `MCP Time Server running on stdio`.

Manual probe 3:

```bash
cd /tmp/cherry-uar-closeout/runtime-cwd
# runtime-cwd contains only src/uar/runtime/matching/models -> vendor model assets
LLM_API_KEY="$OPENAI_API_KEY" UAR_SERVER__LOG_FORMAT=compact \
  resources/binaries/darwin-arm64/universal-agent-runtime \
  --config /tmp/cherry-uar-closeout/config.embedded.yaml \
  --port 19061
```

Result:

- Process stayed alive.
- No listener appeared on `127.0.0.1:19061` after 30 seconds.
- Logs:

```text
Could not load mcp.json — starting with empty MCP registry.
Skills directory not found: "skills"
Burn inference running in generic placeholder mode
```

Blocker:

- The packaged UAR binary can start, but manual direct sidecar smoke did not reach HTTP readiness.
- Suspected owner scope: packaged sidecar runtime startup and cwd/resource discovery.
- Staging impact: runtime-specific blocker for direct UAR embedded live smoke. Automated main-process UAR smoke remains recorded as previously passing, but this closeout did not reproduce live HTTP readiness manually.

## KBD Audit Trail Decision

Completed native KBD change files were kept in place:

- `.kbd-orchestrator/changes/change-001-runtime-agent-model/change.md`
- `.kbd-orchestrator/changes/change-002-runtime-settings-ui/change.md`
- `.kbd-orchestrator/changes/change-003-uar-execution-settings/change.md`
- `.kbd-orchestrator/changes/change-004-runtime-context-pipeline/change.md`
- `.kbd-orchestrator/changes/change-005-runtime-skill-knowledge-bridge/change.md`
- `.kbd-orchestrator/changes/change-006-codex-runtime-parity/change.md`
- `.kbd-orchestrator/changes/change-007-opencode-runtime-parity/change.md`
- `.kbd-orchestrator/changes/change-008-runtime-chat-telemetry/change.md`
- `.kbd-orchestrator/changes/change-009-runtime-validation-hardening/change.md`
- `.kbd-orchestrator/changes/change-010-runtime-control-plane/change.md`
- `.kbd-orchestrator/changes/change-011-runtime-session-bindings/change.md`
- `.kbd-orchestrator/changes/change-012-runtime-approval-response-flow/change.md`
- `.kbd-orchestrator/changes/change-013-uar-electron-smoke/change.md`

Rationale:

- The repository has no established native KBD archive convention.
- The change files are the most complete audit trail for this branch.
- Archiving them now would reduce inspectability before staging.

## Lint Warning Cleanup Decision

Skipped for this pass:

- `resources/skills/prometheus-skill-system/scripts/build-marketplace.js`
- `src/renderer/src/hooks/useSkills.ts`
- `src/renderer/src/pages/settings/AgentSettings/components/RuntimeSettings.tsx`

Rationale:

- Existing warnings are non-fatal under the recorded green `pnpm lint` gate.
- This closeout is validation-only.
- Cleanup should remain a separate optional task unless it intersects with a smoke blocker fix.

## Closeout Result

Diff review is complete and no suspicious out-of-scope diff item was found.

Real runtime UI smoke was not completed because the app exits during startup while syncing built-in Prometheus skills to the DB.

Direct UAR embedded smoke was not completed because the packaged sidecar process stayed alive but did not bind the requested HTTP port during manual probes.

No staging or commit operation was performed during this closeout.
