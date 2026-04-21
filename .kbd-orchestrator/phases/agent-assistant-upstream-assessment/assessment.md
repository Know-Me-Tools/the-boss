ASSESSMENT: agent-assistant-upstream-assessment
Project: The Boss / Cherry Studio fork
Date: 2026-04-17T13:18:15Z
Codebase baseline: local `upstream/main` is `41554411d164f69fad6a8ec23deb4925d4887af6`; current HEAD is `15f44f9029ab667d810fb61997bf8e3d484ec845`; merge-base is the upstream commit, so committed fork deltas are the commits after the upstream merge plus the current dirty worktree.
Cross-tool progress: none recorded; `.kbd-orchestrator` and `openspec` did not exist before this assessment artifact was created.

ORIGIN UPSTREAM AGENT DESIGN

The upstream project treats Agents as a separate execution surface from normal chat Assistants. The public positioning on `cherry-ai.com` describes Cherry Studio as having "Beyond AI Assistants" agent capabilities: autonomous AI that can think, plan, act, call tools, and execute while the user remains in control. That product framing is reflected in the code: Assistants are chat personas/topics in the renderer store, while Agents are persisted main-process entities with sessions, filesystem access scopes, permission modes, MCP/tool access, and a runtime backed by `@anthropic-ai/claude-agent-sdk`.

The official Cherry Agent tutorial says Cherry Studio v1.7.0.alpha introduced Agents and instructs users to create a provider of type Anthropic, start the API server, create an Agent, then edit the Agent's permissions and tools/MCP services. The same docs warn that agent mode consumes many tokens. The code-tools documentation separately covers Code Agents introduced in v1.5.7 and says Claude Code requires a model/provider that supports the Anthropic API Endpoint format. This matters because upstream "Agent" is not just a richer Assistant setting; it is a Claude Code/agent-runtime path with Anthropic-shaped execution assumptions.

In upstream code, the core agent type remains `AgentTypeSchema = z.enum(['claude-code'])` in `src/renderer/src/types/agent.ts`, even after CherryClaw behavior was added through configuration and service modules. Agent configuration includes Claude Code permission modes (`default`, `acceptEdits`, `bypassPermissions`, `plan`), `max_turns`, environment variables, MCPs, allowed tools, slash commands, and CherryClaw scheduler/heartbeat fields. The upstream DB and API layer persist agents and sessions separately from chat topics and assistant presets.

The upstream execution path is: API/renderer creates an agent session message, `SessionMessageService.createSessionMessage()` starts a stream, `ClaudeCodeService.invoke()` validates the session's accessible path and model, prepares `ANTHROPIC_*` environment variables, launches the Claude Agent SDK query, then transforms SDK events into AI SDK `TextStreamPart` chunks. It also reconciles per-agent skill symlinks in the workspace before launch, injects MCP servers such as browser/skills/workspace memory, applies permission hooks, and tracks the SDK session id for resume.

Upstream intentionally limits Claude Code runtime providers to Anthropic-compatible execution. The upstream `ClaudeCodeService` accepts provider type `anthropic`, `azure-openai`, or a provider with `anthropicApiHost`; otherwise it emits an error. GitHub issue #13507 confirms this was recognized as an architectural constraint: agents were tied tightly to `@anthropic-ai/claude-agent-sdk`, and the suggested path for OpenAI/Gemini support was a provider-agnostic execution layer; proxying Anthropic format to other APIs was described as fragile with known issues.

The built-in `resources/builtin-agents/cherry-assistant/agent.json` is also instructive. It is an Agent of type `claude-code`, but its prompt says it is the built-in Cherry Studio usage advisor, not Claude Code and not a general programming assistant. Its job is to diagnose Cherry Studio issues, guide operations, collect FAQs, file bugs/features with confirmation, and search/create skills. Its security boundaries say it should only answer Cherry Studio usage questions, not directly modify user data/configuration, not execute destructive operations, redact secrets, and refuse unrelated roleplay/writing/code requests. It has no default `allowed_tools` or `mcps`; runtime code selectively injects the assistant MCP tools for this built-in agent.

Normal Assistants are different. `src/renderer/src/store/assistants.ts` is deprecated and marked as blocked for feature changes during the v2 refactor. It stores `defaultAssistant`, `assistants`, `presets`, topics, tags, and a deprecated `unifiedListOrder`. That historical name overlap is a source of confusion: old "agent/preset" concepts in the assistant store are not the same as the current autonomous Agent runtime. The agent UI does reuse an `Assistant`-shaped stub in `AgentSessionInputbar` so shared inputbar components can work, but upstream comments and behavior keep this as an adapter convenience: the session still sends through the agent API/runtime, and model mentions are explicitly unsupported for agent sessions.

IMPLEMENTATION STATUS

- Upstream agent/assistant boundary: DONE — upstream cleanly separates agent persistence/execution from assistant chat state. Evidence: `src/main/services/agents/**`, `src/main/apiServer/routes/agents/**`, `src/renderer/src/types/agent.ts`, `src/renderer/src/pages/agents/**`, and deprecated assistant store state in `src/renderer/src/store/assistants.ts`.
- Built-in Cherry Assistant role: DONE upstream; VALID FORK ALTERATION with minor copy risk — the fork mostly rebrands Cherry Studio to The Boss while preserving the role boundary. Evidence: `resources/builtin-agents/cherry-assistant/agent.json` diff changes product names and log paths but leaves "not Claude Code, not a general programming assistant" intact. Minor issue: English prompt now says "focused on the The Boss product".
- Provider/runtime routing: PARTIAL and PROBLEMATIC — the fork extends Claude Code runtime routing to OpenAI/OpenAI Responses and Vertex through local compatibility proxy routes. Evidence: `src/main/services/agents/services/claudecode/providerRoutes.ts`, `src/main/apiServer/services/messages.compat.ts`, and `src/main/services/agents/services/claudecode/index.ts`. This is a valid product goal, but it departs from upstream's intended execution architecture and matches the risk called out in issue #13507.
- Agent-visible provider list: PARTIAL and PROBLEMATIC — `getAvailableProviders()` exposes `ollama` and `new-api`, but `validateProvider()` supports only `openai`, `openai-response`, `anthropic`, and `vertexai`, while `resolveClaudeCodeProviderRoute()` has no `ollama` or `new-api` route. Evidence: `src/main/apiServer/utils/index.ts` and `providerRoutes.ts`. This can surface selectable providers that later fail at runtime.
- A2A / AG-UI / A2UI adapters: PARTIAL and VALID FORK EXTENSION WITH HONESTY RISK — the fork adds external protocol routes and clearly uses The Boss-specific routing metadata. Evidence: `src/main/apiServer/routes/a2a/jsonRpc.ts`, `agentCard.ts`, `messagesAgUi.ts`, and `messagesRestA2ui.ts`. The implementation is additive, but it should be documented as subset/fork-specific because it routes by `metadata.theBoss.agentId/sessionId` and does not implement a full general A2A runtime.
- Agent knowledge-base support: PARTIAL and VALID FORK EXTENSION WITH SECURITY/CONTEXT RISK — the fork adds `knowledge_bases`, `knowledgeRecognition`, and runtime provider snapshots to agents/sessions and injects references into the prompt before invoking Claude Code. Evidence: `src/renderer/src/types/agent.ts`, `src/main/services/agents/database/schema/*.ts`, `src/main/services/agents/services/SessionMessageService.ts`. This is coherent as a fork capability, but it is not upstream behavior and must be treated as untrusted-context injection into an autonomous tool-using session.
- Agent context strategy: PARTIAL and MOSTLY UPSTREAM-ALIGNED FORK EXTENSION — the fork uses the Claude Agent SDK `/compact` command before resumed turns when token thresholds are reached. Evidence: `src/main/services/agents/services/agentContextStrategy/preCompact.ts` and `SessionMessageService.ts`. This respects the agent runtime more than chat-style message trimming would. Risk remains in schema/migration consistency for `last_total_tokens`.
- Skills in agent sessions: PARTIAL and RISKY — upstream recently added per-agent skills via workspace symlinks; the fork adds a separate global/per-agent skill selection layer and emits skill chunks before agent messages. Evidence: `SessionMessageService.ts`, `src/main/services/skills/buildSkillStreamParts.ts`, `src/renderer/src/types/skillConfig.ts`. This may be valid if documented as The Boss skill orchestration, but it overlaps with upstream Claude/project skill loading and can produce two different "skill" concepts in one agent run.
- Assistant skill/context controls: PARTIAL and PROBLEMATIC UNDER LOCAL CONSTRAINTS — the fork adds `skillConfig` Redux state, assistant/topic skill overrides, and assistant pipeline skill chunks in `messageThunk.ts`. This is functionally an assistant feature, not an agent feature. The problem is constraint compliance: `src/renderer/src/store/index.ts` and `messageThunk.ts` are marked as blocked/deprecated for v2 refactor, and AGENTS.md says not to add new Redux slices or change existing state shape until v2.0.0.
- Agent session inputbar reuse of assistant shape: DONE upstream; VALID EXTENSION IF KEPT AS ADAPTER — current code still uses an `Assistant` stub for agent sessions, and the fork adds knowledge-base state to that stub. Evidence: `src/renderer/src/pages/agents/components/AgentSessionInputbar.tsx`. This remains acceptable only if agent messages continue through the agent API and not the assistant chat runtime.
- Schema/migration history: PARTIAL and PROBLEMATIC — committed fork changes add migration files with `0006_` and `0007_` prefixes before upstream's own `0006_famous_fallen_one` and `0007_strange_galactus`, producing a journal with inserted idx 6/7 and shifted upstream idx 8/9. Evidence: `resources/database/drizzle/meta/_journal.json` and `resources/database/drizzle/*.sql`. `MigrationService.ensureCriticalSchemaCompatibility()` repairs only knowledge columns, not `agents.skill_config` or `sessions.last_total_tokens`, so schema drift repair is incomplete.

CROSS-TOOL PROGRESS

- NONE — no `.kbd-orchestrator/phases/agent-assistant-upstream-assessment/progress.json` existed before this run.

SPEC GAP SUMMARY

- Counter to upstream intent: OpenAI/Vertex execution through a compatibility proxy is the strongest departure. Upstream intended Agents to run through Claude Agent SDK against Anthropic-compatible endpoints. Issue #13507 supports that broader provider support was a known requested feature, but not the original runtime contract.
- Valid fork extension: A2A/AG-UI/A2UI routes are additive and do not inherently violate upstream design if documented as The Boss-specific adapters. They become problematic only if represented as complete standards-compliant generic agent APIs.
- Valid fork extension with risk: Agent knowledge/context management can improve usefulness, but it injects retrieved content into a tool-capable autonomous session. It needs source labeling, prompt-injection handling, and explicit tests around permission/tool behavior when knowledge text includes tool instructions.
- Problematic local constraint violation: `skillConfig` Redux slice and assistant/topic skill routing touch v2-blocked store/thunk files. Even if the feature is desired, the change is counter to local AGENTS.md constraints.
- Problematic migration shape: Fork-specific migrations were inserted around upstream migrations instead of appended after upstream head. This is not just style; it can create deployment-order ambiguity and partial drift repair.
- Ambiguous semantics: "skills" now means at least three things: Claude/project skills loaded by the agent SDK, upstream per-agent workspace symlinks, and fork-level LLM/embedding-selected prompt injections. That ambiguity should be resolved in naming and docs.

BUILD HEALTH

- build check: UNKNOWN — full `pnpm build:check` was not run for this assessment.
- targeted tests: FAIL/PARTIAL — command run:
  `pnpm exec vitest run src/main/services/agents/services/claudecode/__tests__/providerRoutes.test.ts src/main/apiServer/protocols/__tests__/agUiMapper.test.ts src/main/apiServer/protocols/__tests__/a2uiValidation.test.ts src/main/services/agents/services/__tests__/SessionMessageService.knowledge.test.ts src/main/services/agents/services/__tests__/SessionService.persistence.test.ts src/main/services/agents/database/__tests__/MigrationService.test.ts`
- test result detail: 5 test files passed, 13 tests passed; `src/main/services/agents/services/__tests__/SessionService.persistence.test.ts` failed before running tests because its `electron-store` mock is not constructible when `ConfigManager` executes `new Store()`.
- known violations: local dirty worktree includes additional changes in runtime provider config, agent message service, assistant skill settings, skill chunk emission, store migration, and `messageThunk.ts`; this assessment separates those from committed fork deltas where material.
- test coverage: PARTIAL — provider routing, A2UI/AG-UI protocol mapping, knowledge persistence, and migration repair have tests, but the current focused run shows at least one suite setup failure and does not prove end-to-end agent execution across native Anthropic vs compat proxy routes.

CONSTRAINT CHECK

- AGENTS.md violations: PRESENT — `src/renderer/src/store/index.ts` adds a new persisted Redux slice (`skillConfig`) and bumps persistence version, while AGENTS.md says not to add new Redux slices or change state shape until v2.0.0. `src/renderer/src/store/thunk/messageThunk.ts` also adds assistant skill/context behavior in a file explicitly marked blocked for v2 refactor.
- constraints.md violations: N/A — no `.kbd-orchestrator/constraints.md` exists.
- logging constraint: mostly respected in inspected files; new services use `loggerService` rather than `console.log`.
- upstream-main freeze constraint: the current branch is `main` and upstream project policy says main accepts only critical fixes. Several assessed changes are features/refactors, not hotfixes.

GOAL PROGRESS

- Explain upstream origin agent design: MET — upstream product docs, local upstream code, built-in agent config, and GitHub issue evidence all support the conclusion that Agents are autonomous, tool-capable, Claude Agent SDK-backed sessions distinct from chat Assistants.
- Determine valid fork alterations: MET — rebranding, adapter APIs, agent knowledge/context support, and `/compact` context management are valid fork goals when documented and tested as The Boss-specific extensions.
- Determine problematic departures: MET — compatibility proxy execution for non-Anthropic models, provider list/route mismatch, Redux state expansion in blocked files, ambiguous skill semantics, and migration ordering are concrete problematic departures.
- Separate committed vs dirty worktree changes: MET — committed deltas account for the major architectural changes; dirty worktree changes mainly add skip-skill behavior when knowledge bases are present and adjust skill summary i18n keys.
- Use external research: MET — Tavily was used for Cherry official docs, Cherry homepage, GitHub issue #13507, and Cherry release/PR context.

DETAILED ASSESSMENT OF DEPARTURES

1. Provider proxy route for OpenAI/Vertex

Classification: PROBLEMATIC DIVERGENCE from upstream intent; potentially valid fork feature if redesigned as a provider-agnostic agent runtime.

Evidence: upstream `ClaudeCodeService` rejected non-Anthropic-compatible providers. Fork `resolveClaudeCodeProviderRoute()` returns `compat_proxy_openai` for `openai` and `openai-response`, and `compat_proxy_vertex` for `vertexai`. Fork `ClaudeCodeService` points `ANTHROPIC_BASE_URL` to the local API server for proxy routes and uses the API server key as Anthropic auth. `messages.compat.ts` converts Anthropic Messages request shapes into AI SDK model messages.

Risk: Claude Code SDK behavior depends on Anthropic message semantics, tool-use shapes, stop reasons, token usage, and streaming event assumptions. The proxy may make simple prompts work while silently degrading tool calls, permission decisions, resume behavior, or model-specific reasoning. This matches the concern in GitHub issue #13507 that proxying Anthropic format to other APIs is fragile.

Recommendation: keep native Anthropic-compatible execution as the default supported path. If OpenAI/Vertex support stays, label it experimental and add end-to-end tests for tool calls, tool results, aborts, permission denial, resume, images, token accounting, and failure propagation. Longer term, build a real provider-agnostic agent execution abstraction instead of routing everything through Claude Code SDK assumptions.

2. Provider availability mismatch

Classification: PROBLEMATIC.

Evidence: `getAvailableProviders()` includes `ollama` and `new-api` in the agent-visible supported type list, while `validateProvider()` excludes them and `resolveClaudeCodeProviderRoute()` cannot route them. The runtime also only assigns placeholder API keys for `ollama` and `lmstudio`, but that does not matter if the route rejects them first.

Risk: users can be shown agent models that cannot execute. This creates a false support signal and shifts failure from selection time to runtime.

Recommendation: align `getAvailableProviders()`, `validateProvider()`, `getProviderAnthropicModelChecker()`, and `resolveClaudeCodeProviderRoute()` behind one support matrix. Do not expose provider types without a tested route.

3. A2A, AG-UI, and A2UI API adapters

Classification: VALID FORK EXTENSION WITH DOCUMENTATION RISK.

Evidence: new routes implement `/v1/a2a`, `/.well-known/agent.json`, `/messages/ag-ui`, and `/messages/buffer`. The code comments acknowledge subset behavior, such as A2A supporting `message/send` and `message/stream`, and routing via `params.metadata.theBoss`.

Risk: a public agent card may imply broader standard compliance than implemented. The adapter currently wraps an existing The Boss session, not a discoverable fleet of protocol-native agents.

Recommendation: document these as "The Boss A2A subset" and "AG-UI event mapping over The Boss sessions." Include compatibility tables and negative tests for unsupported A2A methods.

4. Agent knowledge-base integration

Classification: VALID FORK EXTENSION WITH SECURITY RISK.

Evidence: agent/session schemas add knowledge fields, services snapshot knowledge runtime configs, and `SessionMessageService` runs `KnowledgeService.search/rerank`, builds a citation prompt, emits `data-external-tool-*` parts, and persists citation blocks for headless exchanges.

Risk: upstream agents already have filesystem/tool power; injecting retrieved text as prompt context can introduce prompt-injection instructions. The current code treats retrieved documents as reference material, but the autonomous runtime may still follow malicious text if the system prompt/tool permission layer is not explicit enough.

Recommendation: add a knowledge safety preamble that tells the agent retrieved content is untrusted data, not instructions. Test knowledge text that tries to trigger tool calls, path reads, or prompt disclosure.

5. Agent context strategy via `/compact`

Classification: VALID FORK EXTENSION.

Evidence: `shouldRunSdkCompactBeforeTurn()` only runs when a strategy is enabled, a resumable SDK session exists, the user prompt does not include `/clear`, and last token usage exceeds the threshold. The UI translations explicitly distinguish agent SDK `/compact` from chat sliding-window trimming.

Risk: persistence depends on `sessions.last_total_tokens` being migrated correctly. Current migration repair does not include that column if drift occurs.

Recommendation: repair migration ordering and include `last_total_tokens` in compatibility checks or remove repair fallback and rely on clean append-only migrations.

6. Skill config and skill stream injection

Classification: MIXED. Valid capability goal, problematic current boundary and constraints.

Evidence: `skillConfig` adds global and agent override state. `SessionMessageService` loads global skill config, resolves agent/session overrides, emits skill stream parts, and appends skill context to the prompt. `messageThunk.ts` does similar work for normal Assistants and topics.

Risk: upstream per-agent skill support uses Claude/project skill loading via workspace symlinks. Fork prompt-injected skills are a second system with different selection, context, and UI semantics. Users and future maintainers can confuse "agent-authored skills", "enabled Claude skills", and "selected prompt-injected skills." On the assistant side, the implementation violates local v2 state constraints.

Recommendation: rename the fork layer to "skill context selection" or similar; keep it explicitly separate from Claude SDK skill installation/enabling. Move assistant/topic skill state out of blocked v2 store files or defer until v2.

7. Migration history

Classification: PROBLEMATIC.

Evidence: fork migrations add `0006_context_last_tokens.sql`, `0006_wonderful_the_leader.sql`, and `0007_agent_session_knowledge_access.sql`; the journal then shifts upstream `0006_famous_fallen_one` and `0007_strange_galactus` to idx 8 and 9. `ensureCriticalSchemaCompatibility()` repairs knowledge columns only.

Risk: future upstream merges and already-deployed databases may disagree about which idx/tag set has run. Duplicate numeric prefixes make manual diagnosis harder. Missing drift repair for `skill_config` and `last_total_tokens` can still break fork-only code paths.

Recommendation: append fork migrations after the current upstream journal tail, with unique monotonically increasing tags. Add a one-time reconciliation migration or explicit startup compatibility check for all fork-added columns.

SOURCES

- Official Cherry Agent tutorial: https://docs.cherry-ai.com/docs/en-us/advanced-basic/agent
- Official Cherry Code Tools tutorial: https://docs.cherry-ai.com/docs/en-us/advanced-basic/code-tools-shi-yong-jiao-cheng
- Cherry homepage FAQ/product positioning: https://cherry-ai.com/
- GitHub issue #13507, provider-agnostic agent support request and proxy warning: https://github.com/CherryHQ/cherry-studio/issues/13507
- Cherry releases / PR context for agent runtime and CherryClaw work: https://github.com/CherryHQ/cherry-studio/releases

SYCOPHANCY REVIEW

- MCP status: no `detect_sycophancy` MCP tool was exposed in this session after tool discovery; manual sycophancy-correction skill review applied.
- S-02 check: positive classifications above cite specific source files or public docs.
- S-03 check: assessment names concrete risks: provider proxy fragility, provider support mismatch, Redux/v2 constraint violation, migration ordering, and skill semantic ambiguity.
- S-06 check: avoided unsupported certainty language and separated evidence from inference.
- Manual score: 0.18. The artifact is not structurally flattering; it challenges the fork where the code and upstream evidence support doing so.

ASSESSMENT COMPLETE
