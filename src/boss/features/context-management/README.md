# Context Management

Token-aware context optimization with 4 strategies.

## Key Files
- `src/renderer/src/services/contextStrategies/` — Strategy implementations
- `src/renderer/src/types/contextStrategy.ts` — Type definitions

## Strategies
- **HierarchicalMemory** — Multi-level memory prioritization
- **SlidingWindow** — Fixed-window context retention
- **Summarization** — LLM-based context compression with caching
- **TruncateMiddle** — Smart middle-truncation

## Upstream Impact
- Modifies: `store/settings.ts` (context strategy state), `ConversationService.ts`, `ApiService.ts`, `types/index.ts`, `SettingsPage.tsx`
