# The Boss — Custom Feature Registry

This directory serves as the manifest for all custom features in The Boss fork of Cherry Studio.
It documents what we've added, where it lives, and how it integrates with upstream code.

## Purpose

1. **Merge-conflict early warning** — know which upstream files we touch
2. **Feature isolation tracking** — know what's fully ours vs. shared
3. **Onboarding** — understand the fork's capabilities at a glance

## Feature Areas

| # | Feature | Isolation | Custom Files | Upstream Modified |
|---|---------|-----------|-------------|-------------------|
| 1 | [Context Management](features/context-management/) | High | 8 | 1 |
| 2 | [Skills System](features/skills/) | Medium | 6+ | 4 |
| 3 | [Artifact Studio](features/artifacts/) | High | 50+ | 1 |
| 4 | [MCP Exposure](features/mcp-exposure/) | High | 9 | 1 |
| 5 | [TheBoss SDK](features/theboss-sdk/) | Complete | 11 | 0 |
| 6 | [E2B Integration](features/e2b/) | High | 4 | 1 |
| 7 | [Unstructured.io](features/unstructured/) | High | 5 | 1 |
| 8 | [Reranking](features/reranking/) | High | 3 | 0 |
| 9 | [RAG/Knowledge](features/rag/) | Medium | 1+ | 2 |
| 10 | [Mini-app System](features/minapps/) | High | 2 | 1 |
| 11 | [Agent API Server](features/agent-api/) | Low | 20+ | 2 |
| 12 | [MCP Trace](features/mcp-trace/) | High | 14 | 0 |

## Isolation Levels

- **Complete** — Fully self-contained package, zero upstream file modifications
- **High** — Custom files in separate directories, 0-1 upstream files modified
- **Medium** — Mostly isolated but modifies 2-4 upstream files
- **Low** — Deeply intertwined with upstream code

## Cross-Cutting Modified Upstream Files

These are the **8 core upstream files** that multiple features touch. These are the primary merge-conflict hotspots:

| File | Features That Modify It |
|------|------------------------|
| `package.json` | All (deps) |
| `electron.vite.config.ts` | Build config |
| `src/renderer/src/store/settings.ts` | Context, Skills, Artifacts, E2B, Unstructured |
| `src/renderer/src/App.tsx` | Integration |
| `src/renderer/src/Router.tsx` | Route additions |
| `src/main/services/MCPService.ts` | MCP Exposure |
| `src/main/services/KnowledgeService.ts` | RAG, Unstructured, Reranking |
| `src/main/services/ApiServerService.ts` | Agent API |

## Upstream Sync Workflow

See [UPSTREAM_TOUCHPOINTS.md](UPSTREAM_TOUCHPOINTS.md) for the detailed conflict resolution guide.
