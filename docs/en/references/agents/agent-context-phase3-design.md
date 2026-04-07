# Agent context — Phase 3 design (draft)

## Goals

- Optional **LLM-driven** summarize / hierarchical behavior for **agent** sessions, aligned with product needs without duplicating chat pipelines blindly.
- A **single authority** rule: only one subsystem owns “what the model sees” for a given turn (SDK transcript vs injected system text vs SQLite mirrors).

## Non-goals (for Phase 3)

- Replacing SDK **`resume`** as the source of truth for the live session.
- Running full **`applyContextStrategy`** on `session_messages` rows while also auto-invoking SDK **`/compact`** on the same concern without coordination.

## Proposed building blocks

1. **`context_metadata` (session or agent scope)**  
   Store rolling summary excerpts, summarized message id sets, hierarchical facts, and timestamps—similar to chat `TopicContextMetadata`, but scoped to agent session lifecycle.

2. **Policy layer**  
   When strategy type is summarize/hierarchical (once implemented), decide:  
   - inject summary into **system** or **user prefix**; or  
   - trigger SDK **`/compact`** only; or  
   - both in a defined order (e.g. compact first, then inject short summary).

3. **Instrumentation**  
   Reuse **`ContextManagementStreamPayload`** (or extend it) so UI and AG-UI clients see the same structured events.

4. **Compatibility**  
   Phase 1 behavior (threshold + **`/compact`**) remains the default path until Phase 3 code explicitly enables richer strategies.

## Open questions

- Where to persist metadata (agents DB vs topic-like entity vs SDK-only).
- How to reconcile **AG-UI/A2A** consumers that expect SQLite-backed history with SDK-only transcripts.

This document is a **design placeholder** until implementation tasks are scheduled.
