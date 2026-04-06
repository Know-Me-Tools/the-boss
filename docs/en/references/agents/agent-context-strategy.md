# Agent context strategies (The Boss)

## Where context lives

- **Claude Agent SDK session**: When `resume` is set to the last SDK session id, the model receives prior turns from the SDK’s persisted session, not from SQLite `session_messages`.
- **SQLite `session_messages`**: Used for UI, exports, and AG-UI/A2A streaming; it is not the canonical pre-send message array when `resume` is active.

## Phase 1 (current) vs Phase 3 (planned)

**Phase 1 — implemented today**

- **Non-`none` agent strategies** do **not** run the same pipelines as **chat** (sliding window / summarize / hierarchical over UI messages).
- They enable **token-threshold policy** plus the SDK’s **`/compact`** before the next user turn when the last turn’s reported usage is at or above `compactTriggerTokens` (resumed sessions only). The strategy **type** is reserved for future behavior; operationally you get **SDK compaction**, not chat-style trimming.

**Phase 3 — planned**

- Optional **LLM summarize / hierarchical**-style behavior for agents, coordinated with **`context_metadata`** and a **single-authority** policy so compaction and app-side summarization do not conflict.

## Practical levers

- **`resume`**: Continue the SDK session transcript.
- **Compaction**: The SDK supports `/compact` and emits `compact_boundary` system messages. The app may trigger compaction when policy says the session is over a token threshold (see main-process `agentContextStrategy`).
- **`systemPrompt` / append**: Optional future use for rolling summaries; must not fight SDK compaction without an explicit single-authority policy.

## Single authority

Avoid running chat-style `applyContextStrategy` on persisted rows while also relying on SDK compaction for the same concern, unless the design explicitly separates them (e.g. compaction for the live session, summaries only for injected system text).

## API surfaces

Default REST (`POST .../messages`), AG-UI SSE, and A2A JSON-RPC all call `sessionMessageService.createSessionMessage`, so behavior stays consistent.
