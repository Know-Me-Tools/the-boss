# Upstream Touchpoints — Merge Conflict Guide

When syncing with `upstream/main`, these are the files and patterns to watch.

## High-Risk Files (Conflict on Every Merge)

### `package.json`
- **Our additions**: 15+ new dependencies (sandpack, e2b, unstructured-client, etc.)
- **Resolution**: Keep our additions, accept upstream version bumps. Use `pnpm install` to reconcile.

### `src/renderer/src/store/settings.ts`
- **Our additions**: ~907 lines for context strategy, skills, artifacts, E2B, unstructured settings
- **Resolution**: Our additions are in the `initialState`, reducer actions, and exports sections. Accept upstream structural changes, re-apply our additions at the end of each section.

### `electron.vite.config.ts`
- **Our changes**: Disabled tanstack router-generator plugin (Zod v4 conflict)
- **Resolution**: If upstream updates plugin config, keep our disable comment. Check if Zod issue is resolved in newer tanstack versions.

## Medium-Risk Files (Conflict Occasionally)

### `src/renderer/src/App.tsx`
- **Our changes**: Minimal — provider wrapping order
- **Resolution**: Accept upstream changes, verify provider nesting is correct.

### `src/main/services/MCPService.ts`
- **Our additions**: +24 lines for MCP exposure hooks
- **Resolution**: Our additions are at specific extension points. Re-apply after accepting upstream.

### `src/main/services/KnowledgeService.ts`
- **Our additions**: +63 lines for reranking/unstructured integration
- **Resolution**: Our additions extend existing methods. Re-apply after accepting upstream.

### `src/main/services/ApiServerService.ts`
- **Our additions**: +41 lines for agent API route registration
- **Resolution**: Our additions register new routes. Re-apply after accepting upstream.

## Low-Risk Files (Rarely Conflict)

All files in these directories are fully custom and never conflict:
- `src/renderer/src/features/artifacts/` (50+ files)
- `src/renderer/src/services/contextStrategies/` (8 files)
- `src/main/mcpServers/adapters/` (5 files)
- `src/main/mcpServers/agent-mcp-server.ts` and siblings
- `src/main/services/SkillService.ts` and siblings
- `packages/theboss-sdk/` (entire package)
- `packages/e2b-extended-mcp/` (entire package)
- `src/renderer/src/pages/settings/SkillSettings.tsx` and siblings
- `src/renderer/src/pages/settings/E2BSettings/` (entire directory)
- `src/renderer/src/pages/artifacts/` (entire directory)

## Feature-by-Feature Touchpoints

### 1. Context Management
```
CUSTOM:   src/renderer/src/services/contextStrategies/*
          src/renderer/src/types/contextStrategy.ts
          src/renderer/src/config/models/contextLimits.ts
MODIFIED: src/renderer/src/store/settings.ts (context strategy state + reducers)
          src/renderer/src/types/index.ts (Topic/Assistant context fields)
          src/renderer/src/services/ConversationService.ts
          src/renderer/src/services/ApiService.ts
          src/renderer/src/pages/settings/SettingsPage.tsx (nested route + nav)
```

### 2. Skills System
```
CUSTOM:   src/main/services/SkillService.ts
          src/main/services/SkillValidator.ts
          src/main/services/skillMatching/*
          src/renderer/src/pages/settings/SkillSettings.tsx
          src/renderer/src/pages/settings/SkillCreator/*
          src/renderer/src/services/skills/*
          packages/aiCore/src/core/plugins/built-in/skillPlugin.ts
MODIFIED: src/renderer/src/store/settings.ts (skill settings)
          src/renderer/src/aiCore/plugins/PluginBuilder.ts (+12 lines)
          src/renderer/src/aiCore/plugins/skillsPromptTransform.ts
          src/renderer/src/aiCore/tools/ScriptExecutionTool.ts (+26 lines)
```

### 3. Artifact Studio
```
CUSTOM:   src/renderer/src/features/artifacts/* (50+ files)
          src/renderer/src/pages/artifacts/*
          src/renderer/src/store/artifacts.ts
          src/renderer/src/store/artifactDependencySanitizer.ts
          src/renderer/src/pages/settings/ArtifactSettings.tsx
MODIFIED: src/renderer/src/store/settings.ts (artifact settings)
DEPS:     @codesandbox/sandpack-react, @codesandbox/sandpack-themes
```

### 4. MCP Exposure
```
CUSTOM:   src/main/mcpServers/agent-mcp-server.ts
          src/main/mcpServers/single-agent-mcp-server.ts
          src/main/mcpServers/knowledge-mcp-server.ts
          src/main/mcpServers/single-knowledge-mcp-server.ts
          src/main/mcpServers/sdk-bridge.ts
          src/main/mcpServers/adapters/*
          src/main/apiServer/routes/mcp-expose.ts
          src/main/apiServer/services/mcp-expose.ts
MODIFIED: src/main/services/MCPService.ts (+24 lines)
```

### 5. TheBoss SDK
```
CUSTOM:   packages/theboss-sdk/* (entire package, 11 source files)
MODIFIED: (none)
```

### 6. E2B Integration
```
CUSTOM:   src/main/services/E2BService.ts
          src/main/mcpServers/e2b.ts
          src/renderer/src/store/e2b.ts
          src/renderer/src/pages/settings/E2BSettings/*
MODIFIED: src/renderer/src/store/settings.ts (E2B settings)
DEPS:     @e2b/code-interpreter
```

### 7. Unstructured.io
```
CUSTOM:   src/main/knowledge/preprocess/UnstructuredPreprocessProvider.ts
          src/main/config/unstructuredMimeTypes.ts
          src/renderer/src/pages/settings/DocProcessSettings/UnstructuredSettings.tsx
          src/renderer/src/pages/settings/DocProcessSettings/UnstructuredMimeTypeSelector.tsx
MODIFIED: src/renderer/src/store/settings.ts (unstructured settings)
DEPS:     unstructured-client
```

### 8. Reranking
```
CUSTOM:   src/main/knowledge/reranker/GeneralReranker.ts
          src/main/knowledge/reranker/Reranker.ts
          src/main/knowledge/reranker/strategies/* (6 files)
MODIFIED: (none — integrates via KnowledgeService)
```

### 9. RAG/Knowledge
```
CUSTOM:   src/renderer/src/services/DocumentChunker.ts
MODIFIED: src/main/services/KnowledgeService.ts (+63 lines)
          src/main/knowledge/embedjs/* (enhanced)
          src/main/knowledge/preprocess/* (enhanced)
```

### 10. Mini-app System
```
CUSTOM:   src/main/services/MinAppContextMenuService.ts
          src/renderer/src/utils/minAppContentScript.ts
MODIFIED: (minimal upstream integration)
```

### 11. Agent API Server
```
CUSTOM:   src/main/apiServer/routes/agents/handlers/*
          src/main/apiServer/routes/agents/middleware/*
          src/main/apiServer/routes/agents/validators/*
MODIFIED: src/main/services/ApiServerService.ts (+41 lines)
          src/main/services/agents/* (upstream with extensive custom additions)
NOTE:     This feature is deeply intertwined with upstream agent system.
          Conflicts are likely on upstream agent service changes.
```

### 12. MCP Trace
```
CUSTOM:   packages/mcp-trace/trace-core/* (7 files)
          packages/mcp-trace/trace-node/*
          packages/mcp-trace/trace-web/* (4 files)
MODIFIED: (none — self-contained package)
```
