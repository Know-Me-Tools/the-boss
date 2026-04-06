# Skill Streaming Blocks Design

**Date:** 2026-04-06
**Branch target:** `v2`
**Status:** Approved — ready for implementation planning

---

## Overview

Add a new `SKILL` message block type that streams into the agent UI before the AI response, showing which skills were activated during prompt processing, why they were selected, what content they injected into context, and how many tokens they consumed. Simultaneously introduce a configurable skill selection and context management pipeline with five methods each, configurable globally and per-agent, with fastembed as the default embedding backend.

---

## Goals

- Surface skill activation transparently in the chat UI via streaming blocks
- Give users full visibility into what context was injected and why
- Replace the current "load all skills into context" approach with smart, configurable selection
- Support five selection algorithms and five context management strategies
- Allow global defaults with per-agent overrides
- Use configured embedding models with fastembed (BAAI/bge-small-en-v1.5 via `@mastra/fastembed`) as the zero-config default

---

## Section 1: Data Model

### New Chunk Types (`types/chunk.ts`)

```typescript
// Three new entries in ChunkType enum — mirrors THINKING_*/WEB_SEARCH_* pattern
SKILL_ACTIVATED      // fired once per skill; carries all metadata + full content
SKILL_CONTENT_DELTA  // streaming chunks of injected content text
SKILL_COMPLETE       // fired when all content has been emitted
```

#### `SKILL_ACTIVATED` Payload

```typescript
interface SkillActivatedChunk {
  type: ChunkType.SKILL_ACTIVATED
  skillId: string               // e.g. 'agent-ui-patterns'
  skillName: string             // display name
  triggerTokens: string[]       // matched keywords/phrases
  selectionReason: string       // human-readable rationale from skill metadata
  estimatedTokens: number       // pre-computed after context management
  content: string               // full injected content (also streamed via deltas)
  activationMethod: SkillSelectionMethod
  similarityScore?: number      // for EMBEDDING / HYBRID / TWO_STAGE
  matchedKeywords?: string[]    // for HYBRID / LLM_DELEGATED
  contextManagementMethod: ContextManagementMethod
}
```

### New Block Type (`types/newMessage.ts`)

```typescript
interface SkillMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.SKILL
  skillId: string
  skillName: string
  triggerTokens: string[]
  selectionReason: string
  tokenCount: number
  content: string                            // accumulated from SKILL_CONTENT_DELTA
  activationMethod: SkillSelectionMethod
  similarityScore?: number
  contextManagementMethod: ContextManagementMethod
}
```

`MessageBlockType.SKILL` is added to the `MessageBlockType` enum. Blocks are ordered before `MAIN_TEXT` blocks in the message's `blocks` array.

---

## Section 2: Skill Selection Methods & Configuration

### Selection Method Enum

```typescript
enum SkillSelectionMethod {
  LLM_DELEGATED = 'llm_delegated',  // current behavior — SDK reads all SKILL.md descriptions
  EMBEDDING     = 'embedding',       // cosine similarity via fastembed / configured model
  HYBRID        = 'hybrid',          // BM25 + dense embedding fused via RRF
  LLM_ROUTER    = 'llm_router',      // lightweight LLM classifier → top-K candidates
  TWO_STAGE     = 'two_stage',       // embedding candidates → LLM final selection
}
```

**Default on first launch:** `EMBEDDING` — best balance of quality, latency (<15ms), zero extra LLM cost, correct at 200+ skills.

### Embedding Model Resolution (priority order)

1. Agent-level override (`agentSkillConfig.embeddingModelId`)
2. Global setting (`skillSettings.embeddingModelId`)
3. fastembed built-in (`BAAI/bge-small-en-v1.5` via `@mastra/fastembed` — local Wasm/ONNX, ~3ms warm, no API key)

### Global Settings Shape (new fields in `settings` Redux slice)

```typescript
interface SkillSettings {
  selectionMethod: SkillSelectionMethod          // default: EMBEDDING
  embeddingModelId?: string                       // null → fastembed
  similarityThreshold: number                     // default: 0.35
  topK: number                                    // default: 3
  contextManagementMethod: ContextManagementMethod
  maxSkillTokens: number                          // default: 4096
}
```

### Per-Agent Override (new fields in SQLite `agents` table)

```typescript
interface AgentSkillConfig {
  selectionMethod?: SkillSelectionMethod          // null → inherit global
  embeddingModelId?: string
  similarityThreshold?: number
  topK?: number
  contextManagementMethod?: ContextManagementMethod
  maxSkillTokens?: number
}
```

Agent config lives in the Drizzle SQLite schema (`src/main/services/agents/database/schema/`) — not in the frozen Dexie/IndexedDB schema.

---

## Section 3: Context Management Configuration

### Context Management Method Enum

```typescript
enum ContextManagementMethod {
  FULL_INJECTION      = 'full_injection',      // verbatim content prepended to system prompt
  PREFIX_CACHE_AWARE  = 'prefix_cache_aware',  // skill content first; user message appended after
  CHUNKED_RAG         = 'chunked_rag',         // top-K chunks by similarity
  SUMMARIZED          = 'summarized',           // LLM compression before injection
  PROGRESSIVE         = 'progressive',          // name+description only; full content on demand
}
```

**Default:** `PREFIX_CACHE_AWARE` — zero extra cost, compatible with Anthropic and OpenAI prompt caching, strict improvement over `FULL_INJECTION`.

### Method Behaviors

| Method | Behavior | Best For |
|---|---|---|
| `FULL_INJECTION` | Verbatim content prepended to system prompt | Legacy / debugging |
| `PREFIX_CACHE_AWARE` | Skill blocks at top of context; user message after | Most agents — default |
| `CHUNKED_RAG` | ~500-token chunks; top-K by similarity injected | Large reference skill docs |
| `SUMMARIZED` | Fast LLM compression call before injection | Long skills, token-budget-sensitive agents |
| `PROGRESSIVE` | Only name+description in prompt; full content on demand | Many skills, narrow context budget |

### Token Budget Enforcement

If total selected skills exceed `maxSkillTokens`:
- `CHUNKED_RAG` → reduce chunk count
- `SUMMARIZED` → compress more aggressively
- `FULL_INJECTION` / `PREFIX_CACHE_AWARE` → drop lowest-scored skills until under budget
- `PROGRESSIVE` → already minimal; no truncation needed

`estimatedTokens` on the chunk payload reflects the final count after budget enforcement.

---

## Section 4: SkillBlock UI Component

### Visual Identity

Indigo/violet palette — distinct from:
- Thinking blocks (amber)
- Tool blocks (blue)
- Citation blocks (teal)

### Component States

**PROCESSING** — skill identified, content not yet streaming:
```
╭─ ◈ Preparing skill context...  ░░░░░░░░░░ ──────────────────────╮
│  [shimmer pulse]                                                   │
╰────────────────────────────────────────────────────────────────────╯
```

**STREAMING** — content delta chunks flowing in:
```
╭─ ◈  agent-ui-patterns                           [1,240 tokens] ──╮
│  via embedding  ·  score 0.87  ·  PREFIX_CACHE_AWARE              │
│  ▸ triggers: "streaming", "AG-UI", "event"                        │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│  This skill provides patterns for implementing AG-UI streaming     │
│  events in React frontends. Use RunStartEvent, TextDelta▊         │
╰────────────────────────────────────────────────────────────────────╯
```

**SUCCESS, collapsed** (default final state):
```
╭─ ◈  agent-ui-patterns   [embedding · 0.87]   1,240 tokens   ▾ ──╮
╰────────────────────────────────────────────────────────────────────╯
```

**SUCCESS, expanded**:
```
╭─ ◈  agent-ui-patterns   [embedding · 0.87]   1,240 tokens   ▴ ──╮
│  via PREFIX_CACHE_AWARE                                            │
│  Reason: Matches AG-UI streaming event pattern queries             │
│  Triggers: "streaming"  "AG-UI"  "event"                          │
│  ┄┄┄┄┄┄ injected content ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│  ╔══════════════════════════════════════════════════════════════╗  │
│  ║  [full injected content, monospace, scrollable]              ║  │
│  ╚══════════════════════════════════════════════════════════════╝  │
╰────────────────────────────────────────────────────────────────────╯
```

### Animation

- **PROCESSING → STREAMING:** CSS `@keyframes shimmer` replaced by real content on first `SKILL_CONTENT_DELTA`
- **Content streaming:** `useSmoothStream` hook — same as `MainTextBlock`, consistent feel
- **Collapse transition:** `height` CSS transition with `overflow: hidden`
- **MethodBadge color-coding:** indigo=embedding, violet=hybrid, slate=llm_router, purple=two_stage, gray=llm_delegated

### Component Location

`src/renderer/src/pages/home/Messages/Blocks/SkillBlock.tsx`

Block dispatcher addition (`Blocks/index.tsx`):
```tsx
case MessageBlockType.SKILL:
  return <SkillBlock key={block.id} block={block as SkillMessageBlock} />
```

---

## Section 5: End-to-End Data Flow

```
User sends message
        │
        ▼
messageThunk.ts
        │  1. Resolve config: agent override → global setting → defaults
        │
        │  2. SkillSelector.select(userText, method, config)
        │     ┌─ EMBEDDING:      embed(userText) → cosine search → top-K
        │     ├─ HYBRID:         BM25 + embed → RRF merge → top-K
        │     ├─ LLM_ROUTER:     fast LLM call → ranked candidates
        │     ├─ TWO_STAGE:      embed candidates → LLM final pick
        │     └─ LLM_DELEGATED:  return all (SDK handles selection)
        │
        │  3. For each selected skill:
        │     a. ContextManager.prepare(skill, method, tokenBudget)
        │     b. Compute estimatedTokens
        │
        │  4. Emit chunks (before AI request):
        │     SKILL_ACTIVATED → [SKILL_CONTENT_DELTA × N] → SKILL_COMPLETE
        │
        │  5. Inject prepared content into system prompt
        │
        │  6. Fire AI SDK request → normal TEXT_* stream
        │
        ▼
StreamProcessingService
        ├─ SKILL_ACTIVATED   → skillCallbacks → BlockManager.createBlock(STREAMING)
        ├─ SKILL_CONTENT_DELTA → skillCallbacks → BlockManager.updateBlock (throttled)
        ├─ SKILL_COMPLETE     → skillCallbacks → BlockManager.completeBlock (immediate)
        └─ TEXT_START / TEXT_DELTA / ... (normal flow)
        │
        ▼
React → SkillBlock (STREAMING → SUCCESS/collapsed) + MainTextBlock
```

---

## New Files

| File | Purpose |
|---|---|
| `src/renderer/src/services/skills/SkillSelector.ts` | All 5 selection method implementations |
| `src/renderer/src/services/skills/ContextManager.ts` | All 5 context management implementations |
| `src/renderer/src/services/skills/skillRegistry.ts` | SkillDescriptor registry + fastembed index |
| `src/renderer/src/services/skills/embeddingResolver.ts` | Model priority chain (agent → global → fastembed) |
| `src/renderer/src/services/messageStreaming/callbacks/skillCallbacks.ts` | Chunk → Redux handlers |
| `src/renderer/src/pages/home/Messages/Blocks/SkillBlock.tsx` | UI component |
| `src/renderer/src/pages/settings/SkillSettings.tsx` | Global config UI panel |

## Modified Files

| File | Change |
|---|---|
| `src/renderer/src/types/chunk.ts` | +3 chunk types + payload interfaces |
| `src/renderer/src/types/newMessage.ts` | +`SkillMessageBlock`, +`MessageBlockType.SKILL` |
| `src/renderer/src/store/settings.ts` | +`skillSettings` slice fields |
| `src/renderer/src/services/StreamProcessingService.ts` | Route new chunk types to skillCallbacks |
| `src/renderer/src/pages/home/Messages/Blocks/index.tsx` | +`case SKILL` in dispatcher |
| `src/main/services/agents/database/schema/` | +`skill_config` JSON field to agents table |

---

## Non-Goals (explicitly out of scope)

- No changes to the frozen Dexie/IndexedDB schema
- No new Redux slices (settings slice extended only)
- No changes to `packages/aiCore` middleware pipeline
- No changes to the `.agents/skills/` developer tooling
- No training or fine-tuning of embedding models
