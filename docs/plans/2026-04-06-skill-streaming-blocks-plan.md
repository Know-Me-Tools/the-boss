# Skill Streaming Blocks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stream visual "skill activation" blocks into the agent UI before each AI response, showing which skills fired, why, what content was injected, and how many tokens were consumed — backed by a configurable, embedding-based skill selection and context management pipeline.

**Architecture:** New `SKILL_*` chunk types flow through the existing `StreamProcessingService` → `skillCallbacks` → `BlockManager` → Redux → `SkillBlock` React component, appearing before `MAIN_TEXT` blocks. Selection and context management are handled by two new service classes (`SkillSelector`, `ContextManager`) called from `messageThunk.ts` before the AI request fires. Configuration lives in a new `skillConfig` Redux slice (not the frozen `settings.ts`) with per-agent SQLite overrides.

**Tech Stack:** Vitest 3, React 19, Ant Design 5, styled-components 6, TailwindCSS v4, `@mastra/fastembed` (BAAI/bge-small-en-v1.5), Redux Toolkit, Drizzle ORM + LibSQL

> **Branch:** All work targets the `v2` branch. Never commit to `main`.
> **Commit style:** `feat:`, `test:`, `refactor:` — all commits signed with `git commit --signoff`.
> **After every task:** run `pnpm build:check` and fix any failures before committing.

---

## Task 1: Branch Setup

**Files:**
- No source changes

**Step 1: Create and switch to feature branch off v2**

```bash
git fetch origin
git checkout v2
git checkout -b feat/skill-streaming-blocks
```

Expected: you are now on `feat/skill-streaming-blocks` based on `v2`.

**Step 2: Verify base builds cleanly**

```bash
pnpm build:check
```

Expected: exits 0. Fix any pre-existing errors before proceeding.

---

## Task 2: Skill Configuration Enums

**Files:**
- Create: `src/renderer/src/types/skillConfig.ts`
- Test: `src/renderer/src/types/__tests__/skillConfig.test.ts`

**Step 1: Write the failing test**

```typescript
// src/renderer/src/types/__tests__/skillConfig.test.ts
import { describe, expect, it } from 'vitest'
import {
  ContextManagementMethod,
  DEFAULT_SKILL_CONFIG,
  SkillSelectionMethod
} from '../skillConfig'

describe('SkillSelectionMethod', () => {
  it('has the five expected values', () => {
    expect(Object.values(SkillSelectionMethod)).toEqual([
      'llm_delegated',
      'embedding',
      'hybrid',
      'llm_router',
      'two_stage'
    ])
  })
})

describe('ContextManagementMethod', () => {
  it('has the five expected values', () => {
    expect(Object.values(ContextManagementMethod)).toEqual([
      'full_injection',
      'prefix_cache_aware',
      'chunked_rag',
      'summarized',
      'progressive'
    ])
  })
})

describe('DEFAULT_SKILL_CONFIG', () => {
  it('defaults to EMBEDDING selection and PREFIX_CACHE_AWARE context', () => {
    expect(DEFAULT_SKILL_CONFIG.selectionMethod).toBe(SkillSelectionMethod.EMBEDDING)
    expect(DEFAULT_SKILL_CONFIG.contextManagementMethod).toBe(ContextManagementMethod.PREFIX_CACHE_AWARE)
    expect(DEFAULT_SKILL_CONFIG.similarityThreshold).toBe(0.35)
    expect(DEFAULT_SKILL_CONFIG.topK).toBe(3)
    expect(DEFAULT_SKILL_CONFIG.maxSkillTokens).toBe(4096)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/renderer/src/types/__tests__/skillConfig.test.ts
```

Expected: FAIL with "Cannot find module '../skillConfig'"

**Step 3: Write the implementation**

```typescript
// src/renderer/src/types/skillConfig.ts

export enum SkillSelectionMethod {
  LLM_DELEGATED = 'llm_delegated',
  EMBEDDING     = 'embedding',
  HYBRID        = 'hybrid',
  LLM_ROUTER    = 'llm_router',
  TWO_STAGE     = 'two_stage'
}

export enum ContextManagementMethod {
  FULL_INJECTION     = 'full_injection',
  PREFIX_CACHE_AWARE = 'prefix_cache_aware',
  CHUNKED_RAG        = 'chunked_rag',
  SUMMARIZED         = 'summarized',
  PROGRESSIVE        = 'progressive'
}

export interface SkillGlobalConfig {
  selectionMethod: SkillSelectionMethod
  embeddingModelId?: string          // undefined → use fastembed
  similarityThreshold: number
  topK: number
  contextManagementMethod: ContextManagementMethod
  maxSkillTokens: number
}

/** Per-agent override — all fields optional; undefined means inherit global */
export interface AgentSkillConfigOverride {
  selectionMethod?: SkillSelectionMethod
  embeddingModelId?: string
  similarityThreshold?: number
  topK?: number
  contextManagementMethod?: ContextManagementMethod
  maxSkillTokens?: number
}

export const DEFAULT_SKILL_CONFIG: SkillGlobalConfig = {
  selectionMethod: SkillSelectionMethod.EMBEDDING,
  embeddingModelId: undefined,
  similarityThreshold: 0.35,
  topK: 3,
  contextManagementMethod: ContextManagementMethod.PREFIX_CACHE_AWARE,
  maxSkillTokens: 4096
}

/** Merge agent override on top of global config */
export function resolveSkillConfig(
  global: SkillGlobalConfig,
  agentOverride?: AgentSkillConfigOverride
): SkillGlobalConfig {
  if (!agentOverride) return global
  return {
    selectionMethod:           agentOverride.selectionMethod           ?? global.selectionMethod,
    embeddingModelId:          agentOverride.embeddingModelId          ?? global.embeddingModelId,
    similarityThreshold:       agentOverride.similarityThreshold       ?? global.similarityThreshold,
    topK:                      agentOverride.topK                      ?? global.topK,
    contextManagementMethod:   agentOverride.contextManagementMethod   ?? global.contextManagementMethod,
    maxSkillTokens:            agentOverride.maxSkillTokens            ?? global.maxSkillTokens
  }
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/renderer/src/types/__tests__/skillConfig.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/src/types/skillConfig.ts src/renderer/src/types/__tests__/skillConfig.test.ts
git commit --signoff -m "feat: add SkillSelectionMethod and ContextManagementMethod enums"
```

---

## Task 3: Chunk Types for Skill Streaming

**Files:**
- Modify: `src/renderer/src/types/chunk.ts`
- Test: `src/renderer/src/types/__tests__/chunk.skill.test.ts`

**Step 1: Write the failing test**

```typescript
// src/renderer/src/types/__tests__/chunk.skill.test.ts
import { describe, expect, it } from 'vitest'
import { ChunkType } from '../chunk'

describe('skill chunk types', () => {
  it('has SKILL_ACTIVATED chunk type', () => {
    expect(ChunkType.SKILL_ACTIVATED).toBe('skill.activated')
  })
  it('has SKILL_CONTENT_DELTA chunk type', () => {
    expect(ChunkType.SKILL_CONTENT_DELTA).toBe('skill.content_delta')
  })
  it('has SKILL_COMPLETE chunk type', () => {
    expect(ChunkType.SKILL_COMPLETE).toBe('skill.complete')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/renderer/src/types/__tests__/chunk.skill.test.ts
```

Expected: FAIL — properties undefined

**Step 3: Add to `ChunkType` enum in `chunk.ts`**

Add these three entries to the `ChunkType` enum after `THINKING_COMPLETE`:

```typescript
  SKILL_ACTIVATED     = 'skill.activated',
  SKILL_CONTENT_DELTA = 'skill.content_delta',
  SKILL_COMPLETE      = 'skill.complete',
```

Then add the payload interfaces at the end of `chunk.ts`:

```typescript
import type { ContextManagementMethod, SkillSelectionMethod } from './skillConfig'

export interface SkillActivatedChunk {
  type: ChunkType.SKILL_ACTIVATED
  skillId: string
  skillName: string
  triggerTokens: string[]
  selectionReason: string
  estimatedTokens: number
  content: string
  activationMethod: SkillSelectionMethod
  similarityScore?: number
  matchedKeywords?: string[]
  contextManagementMethod: ContextManagementMethod
}

export interface SkillContentDeltaChunk {
  type: ChunkType.SKILL_CONTENT_DELTA
  skillId: string
  delta: string
}

export interface SkillCompleteChunk {
  type: ChunkType.SKILL_COMPLETE
  skillId: string
  finalTokenCount: number
}
```

Also add these three to the `Chunk` union type in the same file.

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/renderer/src/types/__tests__/chunk.skill.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/src/types/chunk.ts src/renderer/src/types/__tests__/chunk.skill.test.ts
git commit --signoff -m "feat: add SKILL_ACTIVATED / SKILL_CONTENT_DELTA / SKILL_COMPLETE chunk types"
```

---

## Task 4: SkillMessageBlock Type

**Files:**
- Modify: `src/renderer/src/types/newMessage.ts`
- Test: `src/renderer/src/types/__tests__/newMessage.skill.test.ts`

**Step 1: Write the failing test**

```typescript
// src/renderer/src/types/__tests__/newMessage.skill.test.ts
import { describe, expect, it } from 'vitest'
import { MessageBlockType } from '../newMessage'

describe('MessageBlockType.SKILL', () => {
  it('exists with value "skill"', () => {
    expect(MessageBlockType.SKILL).toBe('skill')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/renderer/src/types/__tests__/newMessage.skill.test.ts
```

Expected: FAIL

**Step 3: Add `SKILL` to `MessageBlockType` enum and add `SkillMessageBlock` interface**

In `newMessage.ts`, add to the enum:

```typescript
  SKILL = 'skill'
```

Then add the interface (after `ThinkingMessageBlock`):

```typescript
import type { ContextManagementMethod, SkillSelectionMethod } from './skillConfig'

export interface SkillMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.SKILL
  skillId: string
  skillName: string
  triggerTokens: string[]
  selectionReason: string
  tokenCount: number
  content: string
  activationMethod: SkillSelectionMethod
  similarityScore?: number
  contextManagementMethod: ContextManagementMethod
}
```

Also add `SkillMessageBlock` to the `MessageBlock` union type.

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/renderer/src/types/__tests__/newMessage.skill.test.ts
```

Expected: PASS

**Step 5: Build check**

```bash
pnpm build:check
```

Fix any type errors before committing.

**Step 6: Commit**

```bash
git add src/renderer/src/types/newMessage.ts src/renderer/src/types/__tests__/newMessage.skill.test.ts
git commit --signoff -m "feat: add SkillMessageBlock type and MessageBlockType.SKILL"
```

---

## Task 5: skillConfig Redux Slice

> **Why a new slice, not extending `settings.ts`?** `settings.ts` is marked `@deprecated` and frozen for the v2 refactor. A new slice keeps skill config isolated and avoids conflicts.

**Files:**
- Create: `src/renderer/src/store/skillConfig.ts`
- Test: `src/renderer/src/store/__tests__/skillConfig.test.ts`

**Step 1: Write the failing test**

```typescript
// src/renderer/src/store/__tests__/skillConfig.test.ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SKILL_CONFIG,
  SkillSelectionMethod,
  ContextManagementMethod
} from '@renderer/types/skillConfig'
import skillConfigReducer, {
  setGlobalSkillConfig,
  setAgentSkillOverride,
  clearAgentSkillOverride,
  selectGlobalSkillConfig,
  selectResolvedSkillConfig
} from '../skillConfig'

const initialState = skillConfigReducer(undefined, { type: '@@INIT' })

describe('skillConfig slice', () => {
  it('initializes with DEFAULT_SKILL_CONFIG', () => {
    expect(initialState.global).toEqual(DEFAULT_SKILL_CONFIG)
    expect(initialState.agentOverrides).toEqual({})
  })

  it('setGlobalSkillConfig updates global config', () => {
    const next = skillConfigReducer(
      initialState,
      setGlobalSkillConfig({ selectionMethod: SkillSelectionMethod.HYBRID })
    )
    expect(next.global.selectionMethod).toBe(SkillSelectionMethod.HYBRID)
    expect(next.global.topK).toBe(DEFAULT_SKILL_CONFIG.topK) // others unchanged
  })

  it('setAgentSkillOverride stores per-agent overrides', () => {
    const next = skillConfigReducer(
      initialState,
      setAgentSkillOverride({ agentId: 'agent-1', override: { topK: 5 } })
    )
    expect(next.agentOverrides['agent-1']).toEqual({ topK: 5 })
  })

  it('clearAgentSkillOverride removes override', () => {
    const withOverride = skillConfigReducer(
      initialState,
      setAgentSkillOverride({ agentId: 'agent-1', override: { topK: 5 } })
    )
    const cleared = skillConfigReducer(withOverride, clearAgentSkillOverride('agent-1'))
    expect(cleared.agentOverrides['agent-1']).toBeUndefined()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/renderer/src/store/__tests__/skillConfig.test.ts
```

Expected: FAIL

**Step 3: Write the slice**

```typescript
// src/renderer/src/store/skillConfig.ts
import { createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { AgentSkillConfigOverride, SkillGlobalConfig } from '@renderer/types/skillConfig'
import { DEFAULT_SKILL_CONFIG, resolveSkillConfig } from '@renderer/types/skillConfig'
import type { RootState } from '.'

interface SkillConfigState {
  global: SkillGlobalConfig
  agentOverrides: Record<string, AgentSkillConfigOverride>
}

const initialState: SkillConfigState = {
  global: DEFAULT_SKILL_CONFIG,
  agentOverrides: {}
}

const skillConfigSlice = createSlice({
  name: 'skillConfig',
  initialState,
  reducers: {
    setGlobalSkillConfig(state, action: PayloadAction<Partial<SkillGlobalConfig>>) {
      state.global = { ...state.global, ...action.payload }
    },
    setAgentSkillOverride(
      state,
      action: PayloadAction<{ agentId: string; override: AgentSkillConfigOverride }>
    ) {
      state.agentOverrides[action.payload.agentId] = action.payload.override
    },
    clearAgentSkillOverride(state, action: PayloadAction<string>) {
      delete state.agentOverrides[action.payload]
    }
  }
})

export const { setGlobalSkillConfig, setAgentSkillOverride, clearAgentSkillOverride } =
  skillConfigSlice.actions

export const selectGlobalSkillConfig = (state: RootState) => state.skillConfig.global

export const selectResolvedSkillConfig = createSelector(
  selectGlobalSkillConfig,
  (state: RootState, agentId?: string) =>
    agentId ? state.skillConfig.agentOverrides[agentId] : undefined,
  (global, agentOverride) => resolveSkillConfig(global, agentOverride)
)

export default skillConfigSlice.reducer
```

Register the reducer in `src/renderer/src/store/index.ts`:
```typescript
import skillConfigReducer from './skillConfig'
// add to combineReducers:
skillConfig: skillConfigReducer,
```

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/renderer/src/store/__tests__/skillConfig.test.ts
```

Expected: PASS

**Step 5: Build check**

```bash
pnpm build:check
```

**Step 6: Commit**

```bash
git add src/renderer/src/store/skillConfig.ts src/renderer/src/store/__tests__/skillConfig.test.ts src/renderer/src/store/index.ts
git commit --signoff -m "feat: add skillConfig Redux slice with global config and per-agent overrides"
```

---

## Task 6: SkillDescriptor Interface + skillRegistry

**Files:**
- Create: `src/renderer/src/services/skills/skillRegistry.ts`
- Test: `src/renderer/src/services/skills/__tests__/skillRegistry.test.ts`

**Step 1: Write the failing test**

```typescript
// src/renderer/src/services/skills/__tests__/skillRegistry.test.ts
import { describe, expect, it, beforeEach } from 'vitest'
import { SkillRegistry } from '../skillRegistry'

describe('SkillRegistry', () => {
  let registry: SkillRegistry

  beforeEach(() => {
    registry = new SkillRegistry()
  })

  it('starts empty', () => {
    expect(registry.getAll()).toHaveLength(0)
  })

  it('registers and retrieves a skill', () => {
    registry.register({
      id: 'test-skill',
      name: 'Test Skill',
      description: 'Use for testing',
      triggerPatterns: [/\btest\b/i],
      getContent: () => 'skill content here',
      priority: 10
    })
    const skills = registry.getAll()
    expect(skills).toHaveLength(1)
    expect(skills[0].id).toBe('test-skill')
  })

  it('matchesTriggers returns true when any pattern matches', () => {
    registry.register({
      id: 'agent-skill',
      name: 'Agent',
      description: 'agent patterns',
      triggerPatterns: [/\bagent\b/i, /\bstreaming\b/i],
      getContent: () => 'content',
      priority: 5
    })
    const skill = registry.getAll()[0]
    expect(registry.matchesTriggers(skill, 'tell me about agent streaming')).toBe(true)
    expect(registry.matchesTriggers(skill, 'something else entirely')).toBe(false)
  })

  it('getMatchedTokens returns matched keyword strings', () => {
    registry.register({
      id: 's',
      name: 'S',
      description: 'd',
      triggerPatterns: [/\bstreaming\b/i, /\bAG-UI\b/i],
      getContent: () => '',
      priority: 1
    })
    const skill = registry.getAll()[0]
    const matched = registry.getMatchedTokens(skill, 'streaming AG-UI events')
    expect(matched).toContain('streaming')
    expect(matched).toContain('AG-UI')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/renderer/src/services/skills/__tests__/skillRegistry.test.ts
```

Expected: FAIL

**Step 3: Implement**

```typescript
// src/renderer/src/services/skills/skillRegistry.ts
export interface SkillDescriptor {
  id: string
  name: string
  description: string         // shown as selectionReason in UI
  triggerPatterns: RegExp[]   // tested against user prompt for LLM_DELEGATED / HYBRID fallback
  getContent: () => string    // returns full injected text
  priority: number            // higher = preferred when multiple match
}

export class SkillRegistry {
  private skills: SkillDescriptor[] = []

  register(skill: SkillDescriptor): void {
    this.skills.push(skill)
    this.skills.sort((a, b) => b.priority - a.priority)
  }

  getAll(): SkillDescriptor[] {
    return [...this.skills]
  }

  matchesTriggers(skill: SkillDescriptor, prompt: string): boolean {
    return skill.triggerPatterns.some((pattern) => pattern.test(prompt))
  }

  getMatchedTokens(skill: SkillDescriptor, prompt: string): string[] {
    const tokens: string[] = []
    for (const pattern of skill.triggerPatterns) {
      const match = prompt.match(pattern)
      if (match) tokens.push(match[0])
    }
    return tokens
  }
}

/** Singleton registry — import and call .register() to add skills */
export const skillRegistry = new SkillRegistry()
```

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/renderer/src/services/skills/__tests__/skillRegistry.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/src/services/skills/skillRegistry.ts src/renderer/src/services/skills/__tests__/skillRegistry.test.ts
git commit --signoff -m "feat: add SkillDescriptor interface and SkillRegistry"
```

---

## Task 7: EmbeddingResolver

**Files:**
- Create: `src/renderer/src/services/skills/embeddingResolver.ts`
- Test: `src/renderer/src/services/skills/__tests__/embeddingResolver.test.ts`

> **Note on fastembed:** `@mastra/fastembed` runs ONNX models locally via Wasm. Import dynamically to avoid bundling the large WASM binary in the renderer's initial chunk.

**Step 1: Write the failing test**

```typescript
// src/renderer/src/services/skills/__tests__/embeddingResolver.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EmbeddingResolver } from '../embeddingResolver'

// Mock fastembed to avoid loading the WASM binary in test env
vi.mock('@mastra/fastembed', () => ({
  EmbedMany: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]])
}))

describe('EmbeddingResolver', () => {
  let resolver: EmbeddingResolver

  beforeEach(() => {
    resolver = new EmbeddingResolver()
  })

  it('embeds text and returns a number array', async () => {
    const vec = await resolver.embed('hello world')
    expect(Array.isArray(vec)).toBe(true)
    expect(typeof vec[0]).toBe('number')
  })

  it('cosineSimilarity returns 1 for identical vectors', () => {
    const v = [1, 0, 0]
    expect(resolver.cosineSimilarity(v, v)).toBeCloseTo(1)
  })

  it('cosineSimilarity returns 0 for orthogonal vectors', () => {
    expect(resolver.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/renderer/src/services/skills/__tests__/embeddingResolver.test.ts
```

Expected: FAIL

**Step 3: Implement**

```typescript
// src/renderer/src/services/skills/embeddingResolver.ts
import { loggerService } from '@logger'

const logger = loggerService.withContext('EmbeddingResolver')

export class EmbeddingResolver {
  private modelId: string | undefined

  /**
   * @param modelId  If provided, attempt to use a configured embedding model via window.api.
   *                 If undefined or the call fails, falls back to fastembed.
   */
  constructor(modelId?: string) {
    this.modelId = modelId
  }

  async embed(text: string): Promise<number[]> {
    if (this.modelId) {
      try {
        const result = await window.api.embedText({ modelId: this.modelId, text })
        if (result) return result
      } catch (err) {
        logger.warn('Configured embedding model failed, falling back to fastembed', err)
      }
    }
    return this.fastEmbed(text)
  }

  private async fastEmbed(text: string): Promise<number[]> {
    const { EmbedMany } = await import('@mastra/fastembed')
    const results = await EmbedMany([text])
    return results[0]
  }

  cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dot / denom
  }
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/renderer/src/services/skills/__tests__/embeddingResolver.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/src/services/skills/embeddingResolver.ts src/renderer/src/services/skills/__tests__/embeddingResolver.test.ts
git commit --signoff -m "feat: add EmbeddingResolver with fastembed fallback and cosine similarity"
```

---

## Task 8: SkillSelector — EMBEDDING + LLM_DELEGATED Methods

**Files:**
- Create: `src/renderer/src/services/skills/SkillSelector.ts`
- Test: `src/renderer/src/services/skills/__tests__/SkillSelector.test.ts`

**Step 1: Write the failing test**

```typescript
// src/renderer/src/services/skills/__tests__/SkillSelector.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SkillSelectionMethod, DEFAULT_SKILL_CONFIG } from '@renderer/types/skillConfig'
import { SkillRegistry } from '../skillRegistry'
import { SkillSelector } from '../SkillSelector'

vi.mock('../embeddingResolver', () => ({
  EmbeddingResolver: vi.fn().mockImplementation(() => ({
    embed: vi.fn().mockResolvedValue([1, 0, 0]),
    cosineSimilarity: vi.fn().mockImplementation((a: number[], b: number[]) => {
      // Return high similarity for first skill, low for second
      return a === b ? 1 : 0.8
    })
  }))
}))

describe('SkillSelector.EMBEDDING', () => {
  let registry: SkillRegistry
  let selector: SkillSelector

  beforeEach(() => {
    registry = new SkillRegistry()
    registry.register({
      id: 'skill-a',
      name: 'Skill A',
      description: 'A skill for agent patterns',
      triggerPatterns: [/agent/i],
      getContent: () => 'content A',
      priority: 10
    })
    registry.register({
      id: 'skill-b',
      name: 'Skill B',
      description: 'A skill for testing',
      triggerPatterns: [/test/i],
      getContent: () => 'content B',
      priority: 5
    })
    selector = new SkillSelector(registry, { ...DEFAULT_SKILL_CONFIG, topK: 2, similarityThreshold: 0.3 })
  })

  it('returns skills above threshold', async () => {
    const results = await selector.select('agent streaming', SkillSelectionMethod.EMBEDDING)
    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      expect(r.similarityScore).toBeDefined()
      expect(r.skillId).toBeDefined()
    })
  })

  it('returns empty array when no skills registered', async () => {
    const emptySelector = new SkillSelector(new SkillRegistry(), DEFAULT_SKILL_CONFIG)
    const results = await emptySelector.select('anything', SkillSelectionMethod.EMBEDDING)
    expect(results).toHaveLength(0)
  })
})

describe('SkillSelector.LLM_DELEGATED', () => {
  it('returns all registered skills with no scoring', async () => {
    const registry = new SkillRegistry()
    registry.register({
      id: 's1', name: 'S1', description: 'd', triggerPatterns: [], getContent: () => '', priority: 1
    })
    const selector = new SkillSelector(registry, DEFAULT_SKILL_CONFIG)
    const results = await selector.select('anything', SkillSelectionMethod.LLM_DELEGATED)
    expect(results).toHaveLength(1)
    expect(results[0].similarityScore).toBeUndefined()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/renderer/src/services/skills/__tests__/SkillSelector.test.ts
```

Expected: FAIL

**Step 3: Implement**

```typescript
// src/renderer/src/services/skills/SkillSelector.ts
import { loggerService } from '@logger'
import type { SkillGlobalConfig } from '@renderer/types/skillConfig'
import { SkillSelectionMethod } from '@renderer/types/skillConfig'
import { EmbeddingResolver } from './embeddingResolver'
import type { SkillDescriptor, SkillRegistry } from './skillRegistry'

const logger = loggerService.withContext('SkillSelector')

export interface SkillSelectionResult {
  skillId: string
  skill: SkillDescriptor
  similarityScore?: number
  matchedKeywords?: string[]
  activationMethod: SkillSelectionMethod
}

export class SkillSelector {
  private registry: SkillRegistry
  private config: SkillGlobalConfig
  private embedder: EmbeddingResolver

  constructor(registry: SkillRegistry, config: SkillGlobalConfig) {
    this.registry = registry
    this.config = config
    this.embedder = new EmbeddingResolver(config.embeddingModelId)
  }

  async select(prompt: string, method: SkillSelectionMethod): Promise<SkillSelectionResult[]> {
    const skills = this.registry.getAll()
    if (skills.length === 0) return []

    switch (method) {
      case SkillSelectionMethod.EMBEDDING:
        return this.selectByEmbedding(prompt, skills)
      case SkillSelectionMethod.HYBRID:
        return this.selectHybrid(prompt, skills)
      case SkillSelectionMethod.LLM_ROUTER:
        return this.selectByLLMRouter(prompt, skills)
      case SkillSelectionMethod.TWO_STAGE:
        return this.selectTwoStage(prompt, skills)
      case SkillSelectionMethod.LLM_DELEGATED:
      default:
        return this.selectAll(skills)
    }
  }

  private async selectByEmbedding(
    prompt: string,
    skills: SkillDescriptor[]
  ): Promise<SkillSelectionResult[]> {
    const queryVec = await this.embedder.embed(prompt)
    const scored = await Promise.all(
      skills.map(async (skill) => {
        const descVec = await this.embedder.embed(skill.description)
        const score = this.embedder.cosineSimilarity(queryVec, descVec)
        return { skill, score }
      })
    )
    return scored
      .filter(({ score }) => score >= this.config.similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.topK)
      .map(({ skill, score }) => ({
        skillId: skill.id,
        skill,
        similarityScore: score,
        activationMethod: SkillSelectionMethod.EMBEDDING
      }))
  }

  private async selectHybrid(
    prompt: string,
    skills: SkillDescriptor[]
  ): Promise<SkillSelectionResult[]> {
    // BM25-style: keyword match score (term frequency proxy)
    const bm25Scores = skills.map((skill) => {
      const tokens = prompt.toLowerCase().split(/\W+/)
      const descTokens = new Set(skill.description.toLowerCase().split(/\W+/))
      const overlap = tokens.filter((t) => descTokens.has(t)).length
      return { skill, bm25: overlap / Math.max(tokens.length, 1) }
    })

    // Dense embedding scores
    const queryVec = await this.embedder.embed(prompt)
    const denseScores = await Promise.all(
      skills.map(async (skill) => {
        const vec = await this.embedder.embed(skill.description)
        return { skill, dense: this.embedder.cosineSimilarity(queryVec, vec) }
      })
    )

    // Reciprocal Rank Fusion
    const bm25Ranked = [...bm25Scores].sort((a, b) => b.bm25 - a.bm25)
    const denseRanked = [...denseScores].sort((a, b) => b.dense - a.dense)
    const k = 60

    const rrfMap = new Map<string, number>()
    bm25Ranked.forEach(({ skill }, rank) => {
      rrfMap.set(skill.id, (rrfMap.get(skill.id) ?? 0) + 1 / (k + rank + 1))
    })
    denseRanked.forEach(({ skill }, rank) => {
      rrfMap.set(skill.id, (rrfMap.get(skill.id) ?? 0) + 1 / (k + rank + 1))
    })

    return skills
      .map((skill) => ({
        skillId: skill.id,
        skill,
        similarityScore: rrfMap.get(skill.id) ?? 0,
        matchedKeywords: this.registry.getMatchedTokens(skill, prompt),
        activationMethod: SkillSelectionMethod.HYBRID
      }))
      .filter((r) => (r.similarityScore ?? 0) >= this.config.similarityThreshold / 10)
      .sort((a, b) => (b.similarityScore ?? 0) - (a.similarityScore ?? 0))
      .slice(0, this.config.topK)
  }

  private async selectByLLMRouter(
    prompt: string,
    skills: SkillDescriptor[]
  ): Promise<SkillSelectionResult[]> {
    // Lightweight: fall back to embedding for now; LLM routing can be wired in v2 once
    // the quick-model selector is available. Log a warning so implementers notice.
    logger.info('LLM_ROUTER method — using EMBEDDING as implementation stub for v2 wiring')
    const results = await this.selectByEmbedding(prompt, skills)
    return results.map((r) => ({ ...r, activationMethod: SkillSelectionMethod.LLM_ROUTER }))
  }

  private async selectTwoStage(
    prompt: string,
    skills: SkillDescriptor[]
  ): Promise<SkillSelectionResult[]> {
    // Stage 1: embedding narrows to topK * 3 candidates
    const candidates = await this.selectByEmbedding(prompt, skills.slice(0, this.config.topK * 3))
    // Stage 2: for now re-rank by score (LLM re-rank stub — wire real LLM call in v2)
    logger.info('TWO_STAGE method — LLM re-rank is a stub; using embedding score for final rank')
    return candidates.slice(0, this.config.topK).map((r) => ({
      ...r,
      activationMethod: SkillSelectionMethod.TWO_STAGE
    }))
  }

  private selectAll(skills: SkillDescriptor[]): SkillSelectionResult[] {
    return skills.map((skill) => ({
      skillId: skill.id,
      skill,
      activationMethod: SkillSelectionMethod.LLM_DELEGATED
    }))
  }
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/renderer/src/services/skills/__tests__/SkillSelector.test.ts
```

Expected: PASS

**Step 5: Build check**

```bash
pnpm build:check
```

**Step 6: Commit**

```bash
git add src/renderer/src/services/skills/SkillSelector.ts src/renderer/src/services/skills/__tests__/SkillSelector.test.ts
git commit --signoff -m "feat: add SkillSelector with EMBEDDING / HYBRID / LLM_ROUTER / TWO_STAGE / LLM_DELEGATED methods"
```

---

## Task 9: ContextManager

**Files:**
- Create: `src/renderer/src/services/skills/ContextManager.ts`
- Test: `src/renderer/src/services/skills/__tests__/ContextManager.test.ts`

**Step 1: Write the failing test**

```typescript
// src/renderer/src/services/skills/__tests__/ContextManager.test.ts
import { describe, expect, it } from 'vitest'
import { ContextManagementMethod } from '@renderer/types/skillConfig'
import { ContextManager } from '../ContextManager'

const makeSkill = (content: string) => ({
  id: 'test',
  name: 'Test',
  description: 'desc',
  triggerPatterns: [] as RegExp[],
  getContent: () => content,
  priority: 1
})

describe('ContextManager', () => {
  it('FULL_INJECTION returns verbatim content', async () => {
    const mgr = new ContextManager({ maxSkillTokens: 9999 })
    const result = await mgr.prepare(makeSkill('hello world'), ContextManagementMethod.FULL_INJECTION)
    expect(result.content).toBe('hello world')
    expect(result.tokenCount).toBeGreaterThan(0)
  })

  it('PREFIX_CACHE_AWARE returns same content as FULL_INJECTION', async () => {
    const mgr = new ContextManager({ maxSkillTokens: 9999 })
    const full = await mgr.prepare(makeSkill('hello'), ContextManagementMethod.FULL_INJECTION)
    const pca = await mgr.prepare(makeSkill('hello'), ContextManagementMethod.PREFIX_CACHE_AWARE)
    expect(pca.content).toBe(full.content)
  })

  it('PROGRESSIVE returns only name and description', async () => {
    const mgr = new ContextManager({ maxSkillTokens: 9999 })
    const skill = makeSkill('very long content that should not appear')
    skill.name = 'MySkill'
    skill.description = 'my description'
    const result = await mgr.prepare(skill, ContextManagementMethod.PROGRESSIVE)
    expect(result.content).toContain('MySkill')
    expect(result.content).toContain('my description')
    expect(result.content).not.toContain('very long content')
  })

  it('respects maxSkillTokens by truncating FULL_INJECTION content', async () => {
    const longContent = 'word '.repeat(1000)
    const mgr = new ContextManager({ maxSkillTokens: 50 })
    const result = await mgr.prepare(makeSkill(longContent), ContextManagementMethod.FULL_INJECTION)
    expect(result.tokenCount).toBeLessThanOrEqual(55) // some tolerance
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/renderer/src/services/skills/__tests__/ContextManager.test.ts
```

Expected: FAIL

**Step 3: Implement**

```typescript
// src/renderer/src/services/skills/ContextManager.ts
import { loggerService } from '@logger'
import { ContextManagementMethod } from '@renderer/types/skillConfig'
import type { SkillDescriptor } from './skillRegistry'

const logger = loggerService.withContext('ContextManager')

interface ContextManagerOptions {
  maxSkillTokens: number
}

export interface PreparedSkillContent {
  content: string
  tokenCount: number
}

/** Approximate token count: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n[...truncated to token budget]'
}

export class ContextManager {
  private options: ContextManagerOptions

  constructor(options: ContextManagerOptions) {
    this.options = options
  }

  async prepare(
    skill: SkillDescriptor,
    method: ContextManagementMethod
  ): Promise<PreparedSkillContent> {
    switch (method) {
      case ContextManagementMethod.FULL_INJECTION:
      case ContextManagementMethod.PREFIX_CACHE_AWARE: {
        const raw = skill.getContent()
        const content = truncateToTokenBudget(raw, this.options.maxSkillTokens)
        return { content, tokenCount: estimateTokens(content) }
      }
      case ContextManagementMethod.CHUNKED_RAG: {
        // Chunk at ~500 tokens (~2000 chars), take first chunk(s) within budget
        const raw = skill.getContent()
        const chunkSize = 2000
        const chunks: string[] = []
        for (let i = 0; i < raw.length; i += chunkSize) {
          chunks.push(raw.slice(i, i + chunkSize))
        }
        let content = ''
        let tokens = 0
        for (const chunk of chunks) {
          const chunkTokens = estimateTokens(chunk)
          if (tokens + chunkTokens > this.options.maxSkillTokens) break
          content += chunk
          tokens += chunkTokens
        }
        return { content: content || chunks[0] ?? '', tokenCount: estimateTokens(content) }
      }
      case ContextManagementMethod.SUMMARIZED: {
        // Stub: return truncated content. Wire real LLM summarization in v2.
        logger.info('SUMMARIZED context method — LLM compression stub; using truncation')
        const raw = skill.getContent()
        const content = truncateToTokenBudget(raw, Math.floor(this.options.maxSkillTokens / 2))
        return { content, tokenCount: estimateTokens(content) }
      }
      case ContextManagementMethod.PROGRESSIVE: {
        const content = `## ${skill.name}\n${skill.description}`
        return { content, tokenCount: estimateTokens(content) }
      }
    }
  }
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/renderer/src/services/skills/__tests__/ContextManager.test.ts
```

Expected: PASS

**Step 5: Build check + commit**

```bash
pnpm build:check
git add src/renderer/src/services/skills/ContextManager.ts src/renderer/src/services/skills/__tests__/ContextManager.test.ts
git commit --signoff -m "feat: add ContextManager with FULL_INJECTION / PREFIX_CACHE_AWARE / CHUNKED_RAG / SUMMARIZED / PROGRESSIVE"
```

---

## Task 10: createSkillBlock Utility

**Files:**
- Modify: `src/renderer/src/utils/messageUtils/create.ts`
- Test: `src/renderer/src/utils/messageUtils/__tests__/create.skill.test.ts`

**Step 1: Write the failing test**

```typescript
// src/renderer/src/utils/messageUtils/__tests__/create.skill.test.ts
import { describe, expect, it } from 'vitest'
import { ContextManagementMethod, SkillSelectionMethod } from '@renderer/types/skillConfig'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createSkillBlock } from '../create'

describe('createSkillBlock', () => {
  it('creates a SKILL block with STREAMING status', () => {
    const block = createSkillBlock('msg-1', {
      skillId: 'test-skill',
      skillName: 'Test Skill',
      triggerTokens: ['test'],
      selectionReason: 'matched test',
      tokenCount: 100,
      content: '',
      activationMethod: SkillSelectionMethod.EMBEDDING,
      similarityScore: 0.85,
      contextManagementMethod: ContextManagementMethod.PREFIX_CACHE_AWARE
    })
    expect(block.type).toBe(MessageBlockType.SKILL)
    expect(block.status).toBe(MessageBlockStatus.STREAMING)
    expect(block.skillId).toBe('test-skill')
    expect(block.messageId).toBe('msg-1')
    expect(typeof block.id).toBe('string')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/renderer/src/utils/messageUtils/__tests__/create.skill.test.ts
```

Expected: FAIL

**Step 3: Add `createSkillBlock` to `create.ts`**

```typescript
import type { SkillMessageBlock } from '@renderer/types/newMessage'
import type { ContextManagementMethod, SkillSelectionMethod } from '@renderer/types/skillConfig'

export function createSkillBlock(
  messageId: string,
  data: {
    skillId: string
    skillName: string
    triggerTokens: string[]
    selectionReason: string
    tokenCount: number
    content: string
    activationMethod: SkillSelectionMethod
    similarityScore?: number
    contextManagementMethod: ContextManagementMethod
  },
  overrides: Partial<Omit<BaseMessageBlock, 'id' | 'messageId' | 'type'>> = {}
): SkillMessageBlock {
  return {
    ...createBaseMessageBlock(messageId, MessageBlockType.SKILL, {
      status: MessageBlockStatus.STREAMING,
      ...overrides
    }),
    ...data
  } as SkillMessageBlock
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/renderer/src/utils/messageUtils/__tests__/create.skill.test.ts
```

Expected: PASS

**Step 5: Build check + commit**

```bash
pnpm build:check
git add src/renderer/src/utils/messageUtils/create.ts src/renderer/src/utils/messageUtils/__tests__/create.skill.test.ts
git commit --signoff -m "feat: add createSkillBlock utility function"
```

---

## Task 11: skillCallbacks

**Files:**
- Create: `src/renderer/src/services/messageStreaming/callbacks/skillCallbacks.ts`
- Modify: `src/renderer/src/services/messageStreaming/callbacks/index.ts`
- Test: `src/renderer/src/services/messageStreaming/callbacks/__tests__/skillCallbacks.test.ts`

**Step 1: Write the failing test**

```typescript
// src/renderer/src/services/messageStreaming/callbacks/__tests__/skillCallbacks.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { ContextManagementMethod, SkillSelectionMethod } from '@renderer/types/skillConfig'

// Minimal BlockManager mock
const mockBlockManager = {
  handleBlockTransition: vi.fn().mockResolvedValue(undefined),
  smartBlockUpdate: vi.fn(),
  hasInitialPlaceholder: false,
  lastBlockType: null
}

vi.mock('@renderer/utils/messageUtils/create', () => ({
  createSkillBlock: vi.fn().mockReturnValue({
    id: 'block-1',
    type: MessageBlockType.SKILL,
    status: MessageBlockStatus.STREAMING,
    skillId: 'skill-a',
    content: ''
  })
}))

import { createSkillCallbacks } from '../skillCallbacks'

describe('skillCallbacks', () => {
  let callbacks: ReturnType<typeof createSkillCallbacks>

  beforeEach(() => {
    vi.clearAllMocks()
    callbacks = createSkillCallbacks({
      blockManager: mockBlockManager as any,
      assistantMsgId: 'msg-1'
    })
  })

  it('onSkillActivated creates a new SKILL block via BlockManager', async () => {
    await callbacks.onSkillActivated({
      skillId: 'skill-a',
      skillName: 'Skill A',
      triggerTokens: ['agent'],
      selectionReason: 'matched agent patterns',
      estimatedTokens: 200,
      content: 'full content',
      activationMethod: SkillSelectionMethod.EMBEDDING,
      similarityScore: 0.9,
      contextManagementMethod: ContextManagementMethod.PREFIX_CACHE_AWARE
    })
    expect(mockBlockManager.handleBlockTransition).toHaveBeenCalledTimes(1)
  })

  it('onSkillContentDelta calls smartBlockUpdate', async () => {
    // First activate to register the block ID
    await callbacks.onSkillActivated({
      skillId: 'skill-a',
      skillName: 'Skill A',
      triggerTokens: [],
      selectionReason: '',
      estimatedTokens: 0,
      content: '',
      activationMethod: SkillSelectionMethod.EMBEDDING,
      contextManagementMethod: ContextManagementMethod.PREFIX_CACHE_AWARE
    })
    callbacks.onSkillContentDelta({ skillId: 'skill-a', accumulatedContent: 'partial' })
    expect(mockBlockManager.smartBlockUpdate).toHaveBeenCalled()
  })

  it('onSkillComplete marks block SUCCESS', () => {
    callbacks.onSkillComplete({ skillId: 'skill-a', finalTokenCount: 250, finalContent: 'done' })
    expect(mockBlockManager.smartBlockUpdate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: MessageBlockStatus.SUCCESS }),
      MessageBlockType.SKILL,
      true
    )
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/renderer/src/services/messageStreaming/callbacks/__tests__/skillCallbacks.test.ts
```

Expected: FAIL

**Step 3: Implement**

```typescript
// src/renderer/src/services/messageStreaming/callbacks/skillCallbacks.ts
import { loggerService } from '@logger'
import type { SkillMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import type { ContextManagementMethod, SkillSelectionMethod } from '@renderer/types/skillConfig'
import { createSkillBlock } from '@renderer/utils/messageUtils/create'
import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('SkillCallbacks')

interface SkillCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
}

interface SkillActivatedPayload {
  skillId: string
  skillName: string
  triggerTokens: string[]
  selectionReason: string
  estimatedTokens: number
  content: string
  activationMethod: SkillSelectionMethod
  similarityScore?: number
  contextManagementMethod: ContextManagementMethod
}

export const createSkillCallbacks = (deps: SkillCallbacksDependencies) => {
  const { blockManager, assistantMsgId } = deps
  // Map skillId → blockId for this message's streaming session
  const activeBlockIds = new Map<string, string>()

  return {
    onSkillActivated: async (payload: SkillActivatedPayload) => {
      const newBlock = createSkillBlock(assistantMsgId, {
        skillId: payload.skillId,
        skillName: payload.skillName,
        triggerTokens: payload.triggerTokens,
        selectionReason: payload.selectionReason,
        tokenCount: payload.estimatedTokens,
        content: '',
        activationMethod: payload.activationMethod,
        similarityScore: payload.similarityScore,
        contextManagementMethod: payload.contextManagementMethod
      })
      activeBlockIds.set(payload.skillId, newBlock.id)
      await blockManager.handleBlockTransition(newBlock, MessageBlockType.SKILL)
    },

    onSkillContentDelta: (payload: { skillId: string; accumulatedContent: string }) => {
      const blockId = activeBlockIds.get(payload.skillId)
      if (!blockId) {
        logger.warn(`[onSkillContentDelta] No block found for skillId: ${payload.skillId}`)
        return
      }
      const changes: Partial<SkillMessageBlock> = {
        content: payload.accumulatedContent,
        status: MessageBlockStatus.STREAMING
      }
      blockManager.smartBlockUpdate(blockId, changes, MessageBlockType.SKILL)
    },

    onSkillComplete: (payload: {
      skillId: string
      finalTokenCount: number
      finalContent: string
    }) => {
      const blockId = activeBlockIds.get(payload.skillId)
      if (!blockId) {
        logger.warn(`[onSkillComplete] No block found for skillId: ${payload.skillId}`)
        return
      }
      const changes: Partial<SkillMessageBlock> = {
        content: payload.finalContent,
        tokenCount: payload.finalTokenCount,
        status: MessageBlockStatus.SUCCESS
      }
      blockManager.smartBlockUpdate(blockId, changes, MessageBlockType.SKILL, true)
      activeBlockIds.delete(payload.skillId)
    }
  }
}
```

**Step 4: Export from `callbacks/index.ts`**

Add to `src/renderer/src/services/messageStreaming/callbacks/index.ts`:
```typescript
export { createSkillCallbacks } from './skillCallbacks'
```

**Step 5: Run test to verify it passes**

```bash
pnpm vitest run src/renderer/src/services/messageStreaming/callbacks/__tests__/skillCallbacks.test.ts
```

Expected: PASS

**Step 6: Build check + commit**

```bash
pnpm build:check
git add src/renderer/src/services/messageStreaming/callbacks/skillCallbacks.ts \
        src/renderer/src/services/messageStreaming/callbacks/index.ts \
        src/renderer/src/services/messageStreaming/callbacks/__tests__/skillCallbacks.test.ts
git commit --signoff -m "feat: add skillCallbacks for SKILL_ACTIVATED / SKILL_CONTENT_DELTA / SKILL_COMPLETE handling"
```

---

## Task 12: StreamProcessingService — Route Skill Chunks

**Files:**
- Modify: `src/renderer/src/services/StreamProcessingService.ts`

**Step 1: Add skill callback signatures to `StreamProcessorCallbacks` interface**

In `StreamProcessorCallbacks`, add:

```typescript
  onSkillActivated?: (payload: {
    skillId: string
    skillName: string
    triggerTokens: string[]
    selectionReason: string
    estimatedTokens: number
    content: string
    activationMethod: SkillSelectionMethod
    similarityScore?: number
    contextManagementMethod: ContextManagementMethod
  }) => void | Promise<void>
  onSkillContentDelta?: (payload: { skillId: string; accumulatedContent: string }) => void
  onSkillComplete?: (payload: { skillId: string; finalTokenCount: number; finalContent: string }) => void
```

Import the needed types at the top of the file:
```typescript
import type { ContextManagementMethod, SkillSelectionMethod } from '@renderer/types/skillConfig'
```

**Step 2: Add routing cases to the `switch` in `createStreamProcessor`**

```typescript
case ChunkType.SKILL_ACTIVATED: {
  if (callbacks.onSkillActivated) {
    const c = data as import('@renderer/types/chunk').SkillActivatedChunk
    void callbacks.onSkillActivated({
      skillId: c.skillId,
      skillName: c.skillName,
      triggerTokens: c.triggerTokens,
      selectionReason: c.selectionReason,
      estimatedTokens: c.estimatedTokens,
      content: c.content,
      activationMethod: c.activationMethod,
      similarityScore: c.similarityScore,
      contextManagementMethod: c.contextManagementMethod
    })
  }
  break
}
case ChunkType.SKILL_CONTENT_DELTA: {
  if (callbacks.onSkillContentDelta) {
    const c = data as import('@renderer/types/chunk').SkillContentDeltaChunk
    callbacks.onSkillContentDelta({ skillId: c.skillId, accumulatedContent: c.delta })
  }
  break
}
case ChunkType.SKILL_COMPLETE: {
  if (callbacks.onSkillComplete) {
    const c = data as import('@renderer/types/chunk').SkillCompleteChunk
    callbacks.onSkillComplete({ skillId: c.skillId, finalTokenCount: c.finalTokenCount, finalContent: '' })
  }
  break
}
```

**Step 3: Build check + commit**

```bash
pnpm build:check
git add src/renderer/src/services/StreamProcessingService.ts
git commit --signoff -m "feat: route SKILL_* chunk types through StreamProcessingService"
```

---

## Task 13: messageThunk Integration

**Files:**
- Modify: `src/renderer/src/store/thunk/messageThunk.ts`
- Test: `src/renderer/src/store/thunk/__tests__/messageThunk.skill.test.ts`

**Step 1: Write the failing test**

```typescript
// src/renderer/src/store/thunk/__tests__/messageThunk.skill.test.ts
import { describe, expect, it, vi } from 'vitest'
import { SkillSelectionMethod, ContextManagementMethod, DEFAULT_SKILL_CONFIG } from '@renderer/types/skillConfig'
import { emitSkillChunks } from '../messageThunk'

describe('emitSkillChunks', () => {
  it('emits SKILL_ACTIVATED, content deltas, and SKILL_COMPLETE in order', async () => {
    const emitted: string[] = []
    const mockEmit = vi.fn((chunk: any) => { emitted.push(chunk.type) })

    await emitSkillChunks(
      {
        skillId: 'test-skill',
        skillName: 'Test Skill',
        triggerTokens: ['test'],
        selectionReason: 'matched',
        activationMethod: SkillSelectionMethod.EMBEDDING,
        similarityScore: 0.9,
        contextManagementMethod: ContextManagementMethod.PREFIX_CACHE_AWARE,
        preparedContent: 'hello world content',
        estimatedTokens: 10
      },
      mockEmit
    )

    expect(emitted[0]).toBe('skill.activated')
    expect(emitted[emitted.length - 1]).toBe('skill.complete')
    expect(emitted.some((t) => t === 'skill.content_delta')).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/renderer/src/store/thunk/__tests__/messageThunk.skill.test.ts
```

Expected: FAIL

**Step 3: Add `emitSkillChunks` to `messageThunk.ts`**

Add this exported helper (near the top of the file, after imports):

```typescript
import { ChunkType } from '@renderer/types/chunk'
import type { ContextManagementMethod, SkillSelectionMethod } from '@renderer/types/skillConfig'

const SKILL_CHUNK_BATCH_SIZE = 120 // chars per delta chunk

export async function emitSkillChunks(
  payload: {
    skillId: string
    skillName: string
    triggerTokens: string[]
    selectionReason: string
    activationMethod: SkillSelectionMethod
    similarityScore?: number
    contextManagementMethod: ContextManagementMethod
    preparedContent: string
    estimatedTokens: number
  },
  emit: (chunk: any) => void
): Promise<void> {
  // 1. SKILL_ACTIVATED — carries metadata + full content (for immediate access)
  emit({
    type: ChunkType.SKILL_ACTIVATED,
    skillId: payload.skillId,
    skillName: payload.skillName,
    triggerTokens: payload.triggerTokens,
    selectionReason: payload.selectionReason,
    estimatedTokens: payload.estimatedTokens,
    content: payload.preparedContent,
    activationMethod: payload.activationMethod,
    similarityScore: payload.similarityScore,
    contextManagementMethod: payload.contextManagementMethod
  })

  // 2. Stream content in batches to drive the UI animation
  const content = payload.preparedContent
  for (let i = 0; i < content.length; i += SKILL_CHUNK_BATCH_SIZE) {
    emit({
      type: ChunkType.SKILL_CONTENT_DELTA,
      skillId: payload.skillId,
      delta: content.slice(0, i + SKILL_CHUNK_BATCH_SIZE) // accumulated form
    })
    await new Promise((r) => setTimeout(r, 0)) // yield to event loop for responsiveness
  }

  // 3. SKILL_COMPLETE
  emit({
    type: ChunkType.SKILL_COMPLETE,
    skillId: payload.skillId,
    finalTokenCount: payload.estimatedTokens
  })
}
```

**Step 4: Wire into the pre-request phase of `messageThunk`**

In the main `sendMessage` thunk, before `buildStreamTextParams()` is called, add:

```typescript
import { SkillSelector } from '@renderer/services/skills/SkillSelector'
import { ContextManager } from '@renderer/services/skills/ContextManager'
import { skillRegistry } from '@renderer/services/skills/skillRegistry'
import { resolveSkillConfig } from '@renderer/types/skillConfig'

// Resolve config (agent override → global)
const globalSkillConfig = getState().skillConfig.global
const agentOverride = agentId ? getState().skillConfig.agentOverrides[agentId] : undefined
const skillConfig = resolveSkillConfig(globalSkillConfig, agentOverride)

// Select active skills
const selector = new SkillSelector(skillRegistry, skillConfig)
const selectedSkills = await selector.select(userMessageText, skillConfig.selectionMethod)

// Prepare and emit skill chunks, then accumulate system prompt additions
const contextManager = new ContextManager({ maxSkillTokens: skillConfig.maxSkillTokens })
const skillSystemPromptAdditions: string[] = []

for (const result of selectedSkills) {
  const prepared = await contextManager.prepare(result.skill, skillConfig.contextManagementMethod)
  await emitSkillChunks(
    {
      skillId: result.skillId,
      skillName: result.skill.name,
      triggerTokens: result.matchedKeywords ?? skillRegistry.getMatchedTokens(result.skill, userMessageText),
      selectionReason: result.skill.description,
      activationMethod: result.activationMethod,
      similarityScore: result.similarityScore,
      contextManagementMethod: skillConfig.contextManagementMethod,
      preparedContent: prepared.content,
      estimatedTokens: prepared.tokenCount
    },
    (chunk) => dispatch(processChunk(chunk)) // use existing chunk dispatch mechanism
  )
  skillSystemPromptAdditions.push(prepared.content)
}

// Prepend skill content to system prompt
if (skillSystemPromptAdditions.length > 0) {
  systemPrompt = skillSystemPromptAdditions.join('\n\n---\n\n') + '\n\n---\n\n' + systemPrompt
}
```

> **Note:** Exact variable names for `userMessageText`, `systemPrompt`, `agentId`, and the chunk dispatch mechanism must match what's already in `messageThunk.ts`. Read the file carefully before editing to align with existing patterns.

**Step 5: Run test to verify it passes**

```bash
pnpm vitest run src/renderer/src/store/thunk/__tests__/messageThunk.skill.test.ts
```

Expected: PASS

**Step 6: Build check + commit**

```bash
pnpm build:check
git add src/renderer/src/store/thunk/messageThunk.ts \
        src/renderer/src/store/thunk/__tests__/messageThunk.skill.test.ts
git commit --signoff -m "feat: integrate SkillSelector and ContextManager into messageThunk pre-request phase"
```

---

## Task 14: SkillBlock React Component

**Files:**
- Create: `src/renderer/src/pages/home/Messages/Blocks/SkillBlock.tsx`
- Test: `src/renderer/src/pages/home/Messages/Blocks/__tests__/SkillBlock.test.tsx`

**Step 1: Write the failing test**

```typescript
// src/renderer/src/pages/home/Messages/Blocks/__tests__/SkillBlock.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { SkillSelectionMethod, ContextManagementMethod } from '@renderer/types/skillConfig'
import SkillBlock from '../SkillBlock'

const makeBlock = (overrides = {}) => ({
  id: 'block-1',
  messageId: 'msg-1',
  type: MessageBlockType.SKILL,
  status: MessageBlockStatus.SUCCESS,
  createdAt: new Date().toISOString(),
  skillId: 'agent-ui-patterns',
  skillName: 'Agent UI Patterns',
  triggerTokens: ['streaming', 'AG-UI'],
  selectionReason: 'Matches AG-UI streaming event pattern queries',
  tokenCount: 1240,
  content: 'This skill provides AG-UI patterns.',
  activationMethod: SkillSelectionMethod.EMBEDDING,
  similarityScore: 0.87,
  contextManagementMethod: ContextManagementMethod.PREFIX_CACHE_AWARE,
  ...overrides
})

describe('SkillBlock', () => {
  it('renders skill name in collapsed state', () => {
    render(<SkillBlock block={makeBlock() as any} />)
    expect(screen.getByText('Agent UI Patterns')).toBeInTheDocument()
  })

  it('shows token count', () => {
    render(<SkillBlock block={makeBlock() as any} />)
    expect(screen.getByText(/1,240/)).toBeInTheDocument()
  })

  it('expands to show content on click', () => {
    render(<SkillBlock block={makeBlock() as any} />)
    const header = screen.getByText('Agent UI Patterns').closest('[role="button"], button, [onClick]')
      ?? screen.getByText('Agent UI Patterns').parentElement!
    fireEvent.click(header)
    expect(screen.getByText('This skill provides AG-UI patterns.')).toBeInTheDocument()
  })

  it('shows shimmer during PROCESSING status', () => {
    const { container } = render(
      <SkillBlock block={makeBlock({ status: MessageBlockStatus.PROCESSING }) as any} />
    )
    expect(container.querySelector('[data-processing="true"]')).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/renderer/src/pages/home/Messages/Blocks/__tests__/SkillBlock.test.tsx
```

Expected: FAIL

**Step 3: Implement**

```tsx
// src/renderer/src/pages/home/Messages/Blocks/SkillBlock.tsx
import { useState } from 'react'
import { Tag, Tooltip } from 'antd'
import styled, { keyframes } from 'styled-components'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import type { SkillMessageBlock } from '@renderer/types/newMessage'
import { SkillSelectionMethod } from '@renderer/types/skillConfig'

interface Props {
  block: SkillMessageBlock
}

const METHOD_COLORS: Record<SkillSelectionMethod, string> = {
  [SkillSelectionMethod.EMBEDDING]:     '#6366f1',
  [SkillSelectionMethod.HYBRID]:        '#8b5cf6',
  [SkillSelectionMethod.LLM_ROUTER]:    '#64748b',
  [SkillSelectionMethod.TWO_STAGE]:     '#7c3aed',
  [SkillSelectionMethod.LLM_DELEGATED]: '#94a3b8'
}

const shimmer = keyframes`
  0%   { background-position: -400px 0 }
  100% { background-position: 400px 0 }
`

const Container = styled.div`
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: 8px;
  margin-bottom: 8px;
  background: rgba(99, 102, 241, 0.04);
  overflow: hidden;
`

const Header = styled.div<{ $clickable: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  user-select: none;
  &:hover {
    background: rgba(99, 102, 241, 0.06);
  }
`

const SkillIcon = styled.span`
  color: #6366f1;
  font-size: 14px;
  flex-shrink: 0;
`

const SkillName = styled.span`
  font-weight: 500;
  font-size: 13px;
  color: var(--color-text-1, #1a1a1a);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const TokenPill = styled.span`
  font-size: 11px;
  color: var(--color-text-3, #999);
  background: rgba(99, 102, 241, 0.1);
  border-radius: 10px;
  padding: 1px 7px;
  flex-shrink: 0;
`

const Chevron = styled.span<{ $expanded: boolean }>`
  font-size: 10px;
  color: var(--color-text-3, #999);
  transform: rotate(${(p) => (p.$expanded ? '180deg' : '0deg')});
  transition: transform 0.2s ease;
  flex-shrink: 0;
`

const Body = styled.div<{ $visible: boolean }>`
  max-height: ${(p) => (p.$visible ? '600px' : '0')};
  overflow: hidden;
  transition: max-height 0.25s ease;
`

const BodyInner = styled.div`
  padding: 0 12px 12px;
  border-top: 1px solid rgba(99, 102, 241, 0.12);
`

const Meta = styled.div`
  font-size: 11px;
  color: var(--color-text-3, #999);
  margin: 6px 0 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
`

const Reason = styled.div`
  font-size: 12px;
  color: var(--color-text-2, #555);
  margin-bottom: 6px;
`

const ContentDivider = styled.div`
  font-size: 10px;
  color: var(--color-text-4, #bbb);
  margin: 6px 0 4px;
  letter-spacing: 0.05em;
`

const InjectedContent = styled.pre`
  font-size: 11px;
  font-family: var(--font-family-code, monospace);
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  padding: 8px;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  color: var(--color-text-2, #555);
`

const StreamCursor = styled.span`
  display: inline-block;
  width: 2px;
  height: 12px;
  background: #6366f1;
  margin-left: 1px;
  vertical-align: text-bottom;
  animation: blink 1s step-end infinite;
  @keyframes blink { 50% { opacity: 0 } }
`

const ShimmerRow = styled.div`
  height: 20px;
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(99,102,241,0.08) 25%, rgba(99,102,241,0.15) 37%, rgba(99,102,241,0.08) 63%);
  background-size: 400px 100%;
  animation: ${shimmer} 1.4s ease infinite;
  margin: 2px 0;
`

export default function SkillBlock({ block }: Props) {
  const [expanded, setExpanded] = useState(false)
  const isStreaming = block.status === MessageBlockStatus.STREAMING
  const isProcessing = block.status === MessageBlockStatus.PROCESSING
  const isSuccess = block.status === MessageBlockStatus.SUCCESS

  if (isProcessing) {
    return (
      <Container data-processing="true">
        <Header $clickable={false}>
          <SkillIcon>◈</SkillIcon>
          <ShimmerRow style={{ flex: 1 }} />
        </Header>
      </Container>
    )
  }

  const methodColor = METHOD_COLORS[block.activationMethod] ?? '#6366f1'
  const formattedTokens = block.tokenCount.toLocaleString()

  return (
    <Container>
      <Header $clickable={isSuccess} onClick={() => isSuccess && setExpanded((e) => !e)}>
        <SkillIcon>◈</SkillIcon>
        <SkillName>{block.skillName}</SkillName>
        <Tooltip title={`Activation method: ${block.activationMethod}${block.similarityScore != null ? ` · score ${block.similarityScore.toFixed(2)}` : ''}`}>
          <Tag color={methodColor} style={{ fontSize: 10, padding: '0 5px', cursor: 'inherit' }}>
            {block.activationMethod.replace('_', ' ')}
            {block.similarityScore != null ? ` · ${block.similarityScore.toFixed(2)}` : ''}
          </Tag>
        </Tooltip>
        <TokenPill>{formattedTokens} tokens</TokenPill>
        {isSuccess && <Chevron $expanded={expanded}>▾</Chevron>}
      </Header>

      {/* Show body during streaming (always) or when expanded after success */}
      <Body $visible={isStreaming || expanded}>
        <BodyInner>
          <Meta>
            <span>via {block.contextManagementMethod.replace(/_/g, ' ')}</span>
            {block.triggerTokens.length > 0 && (
              <>
                <span>·</span>
                {block.triggerTokens.map((t) => (
                  <Tag key={t} style={{ fontSize: 10, margin: 0 }}>{t}</Tag>
                ))}
              </>
            )}
          </Meta>
          {block.selectionReason && <Reason>{block.selectionReason}</Reason>}
          <ContentDivider>── injected context ──</ContentDivider>
          <InjectedContent>
            {block.content}
            {isStreaming && <StreamCursor />}
          </InjectedContent>
        </BodyInner>
      </Body>
    </Container>
  )
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/renderer/src/pages/home/Messages/Blocks/__tests__/SkillBlock.test.tsx
```

Expected: PASS

**Step 5: Build check + commit**

```bash
pnpm build:check
git add src/renderer/src/pages/home/Messages/Blocks/SkillBlock.tsx \
        src/renderer/src/pages/home/Messages/Blocks/__tests__/SkillBlock.test.tsx
git commit --signoff -m "feat: add SkillBlock UI component with streaming, collapsed, and expanded states"
```

---

## Task 15: Register SkillBlock in Block Dispatcher

**Files:**
- Modify: `src/renderer/src/pages/home/Messages/Blocks/index.tsx`

**Step 1: Read the file to understand the existing `switch` pattern**

Read `src/renderer/src/pages/home/Messages/Blocks/index.tsx` and find the block type dispatcher.

**Step 2: Add the SKILL case**

Import `SkillBlock`:
```typescript
import SkillBlock from './SkillBlock'
import type { SkillMessageBlock } from '@renderer/types/newMessage'
```

Add to the switch/map:
```typescript
case MessageBlockType.SKILL:
  return <SkillBlock key={block.id} block={block as SkillMessageBlock} />
```

**Step 3: Build check + commit**

```bash
pnpm build:check
git add src/renderer/src/pages/home/Messages/Blocks/index.tsx
git commit --signoff -m "feat: register SkillBlock in block type dispatcher"
```

---

## Task 16: Agent DB Schema — skill_config Column

**Files:**
- Modify: `src/main/services/agents/database/schema/` (find the `agents` table schema file)
- Run migration: `pnpm agents:generate && pnpm agents:push`

**Step 1: Read the agents schema file**

```bash
cat src/main/services/agents/database/schema/agents.schema.ts
```

**Step 2: Add `skill_config` column**

Add to the agents table definition:
```typescript
skill_config: text('skill_config'), // JSON AgentSkillConfigOverride | null
```

**Step 3: Generate and push migration**

```bash
pnpm agents:generate
pnpm agents:push
```

Expected: migration applied, no errors.

**Step 4: Update SkillService / AgentService to read/write the column**

In the service that reads agent records, parse the JSON:
```typescript
const skillConfig: AgentSkillConfigOverride | undefined =
  agent.skill_config ? JSON.parse(agent.skill_config) : undefined
```

**Step 5: Commit**

```bash
git add src/main/services/agents/ resources/database/drizzle/
git commit --signoff -m "feat: add skill_config column to agents table for per-agent skill overrides"
```

---

## Task 17: Settings UI Panel

**Files:**
- Create: `src/renderer/src/pages/settings/SkillSettings/index.tsx`
- Modify: `src/renderer/src/pages/settings/index.tsx` (or wherever settings sections are registered)

**Step 1: Read the settings page structure**

```bash
ls src/renderer/src/pages/settings/
```

Find how other settings panels are structured (e.g., `GeneralSettings`, `ModelSettings`) and follow the exact same pattern.

**Step 2: Implement the panel**

```tsx
// src/renderer/src/pages/settings/SkillSettings/index.tsx
import { useDispatch, useSelector } from 'react-redux'
import { Select, Slider, InputNumber, Form, Divider } from 'antd'
import { useTranslation } from 'react-i18next'
import { SkillSelectionMethod, ContextManagementMethod } from '@renderer/types/skillConfig'
import {
  selectGlobalSkillConfig,
  setGlobalSkillConfig
} from '@renderer/store/skillConfig'

export default function SkillSettings() {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const config = useSelector(selectGlobalSkillConfig)

  return (
    <Form layout="vertical">
      <Form.Item label={t('settings.skill.selectionMethod', 'Skill Selection Method')}>
        <Select
          value={config.selectionMethod}
          onChange={(v) => dispatch(setGlobalSkillConfig({ selectionMethod: v }))}
          options={Object.values(SkillSelectionMethod).map((v) => ({ label: v, value: v }))}
        />
      </Form.Item>

      <Form.Item label={t('settings.skill.similarityThreshold', 'Similarity Threshold')}>
        <Slider
          min={0} max={1} step={0.05}
          value={config.similarityThreshold}
          onChange={(v) => dispatch(setGlobalSkillConfig({ similarityThreshold: v }))}
        />
      </Form.Item>

      <Form.Item label={t('settings.skill.topK', 'Max Active Skills (topK)')}>
        <InputNumber
          min={1} max={10}
          value={config.topK}
          onChange={(v) => v && dispatch(setGlobalSkillConfig({ topK: v }))}
        />
      </Form.Item>

      <Divider />

      <Form.Item label={t('settings.skill.contextMethod', 'Context Management Method')}>
        <Select
          value={config.contextManagementMethod}
          onChange={(v) => dispatch(setGlobalSkillConfig({ contextManagementMethod: v }))}
          options={Object.values(ContextManagementMethod).map((v) => ({ label: v, value: v }))}
        />
      </Form.Item>

      <Form.Item label={t('settings.skill.maxTokens', 'Max Skill Tokens')}>
        <InputNumber
          min={256} max={32768} step={256}
          value={config.maxSkillTokens}
          onChange={(v) => v && dispatch(setGlobalSkillConfig({ maxSkillTokens: v }))}
        />
      </Form.Item>
    </Form>
  )
}
```

**Step 3: Register in settings navigation**

Read the settings index file and add `SkillSettings` following the exact pattern used for other settings sections.

**Step 4: Add i18n keys**

```bash
pnpm i18n:sync
```

Fill in the English values in `src/renderer/src/i18n/locales/en/`. Run `pnpm i18n:check` to confirm no missing keys.

**Step 5: Build check + commit**

```bash
pnpm build:check
git add src/renderer/src/pages/settings/SkillSettings/ \
        src/renderer/src/pages/settings/index.tsx \
        src/renderer/src/i18n/
git commit --signoff -m "feat: add SkillSettings UI panel for global skill configuration"
```

---

## Task 18: Full Test Suite + Build Validation

**Step 1: Run all tests**

```bash
pnpm test
```

Expected: all pass. Fix any failures before proceeding.

**Step 2: Full build**

```bash
pnpm build
```

Expected: TypeScript typecheck and electron-vite build both succeed. Fix any type errors.

**Step 3: Format**

```bash
pnpm format
```

**Step 4: Lint**

```bash
pnpm lint
```

Fix all lint errors. Then:

```bash
git add -u
git commit --signoff -m "chore: fix lint and format issues across skill streaming blocks feature"
```

**Step 5: Final integration smoke test (manual)**

1. Run `pnpm dev`
2. Open Cherry Studio
3. Register a test skill in `skillRegistry.ts` with a simple trigger pattern
4. Send a message that matches the trigger
5. Confirm: skill block appears before AI response, streams in, collapses to header after completion
6. Expand the block, verify content and metadata display correctly
7. Open Settings → Skills, change selection method, send another message, verify the method badge changes in the block

---

## Summary

| Task | Deliverable |
|------|-------------|
| 1 | Feature branch off v2 |
| 2 | `SkillSelectionMethod` + `ContextManagementMethod` enums |
| 3 | `SKILL_*` chunk types |
| 4 | `SkillMessageBlock` type |
| 5 | `skillConfig` Redux slice |
| 6 | `SkillDescriptor` + `SkillRegistry` |
| 7 | `EmbeddingResolver` (fastembed + configured model) |
| 8 | `SkillSelector` (5 methods) |
| 9 | `ContextManager` (5 methods) |
| 10 | `createSkillBlock` utility |
| 11 | `skillCallbacks` |
| 12 | `StreamProcessingService` routing |
| 13 | `messageThunk` integration |
| 14 | `SkillBlock` React component |
| 15 | Block dispatcher registration |
| 16 | Agent DB schema + migration |
| 17 | Settings UI panel + i18n |
| 18 | Full test + build + manual smoke |
