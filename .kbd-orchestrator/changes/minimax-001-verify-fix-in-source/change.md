# change-001 — Re-verify the fix in source

Phase: minimax-agent-protocol · Type: verify · Agent: build-error-resolver (only if red)

Idempotent verification that commit f1b024974 is intact on branch fix/minimax-agent-protocol-chat.

## Tasks
- [x] `fnm use 24 && pnpm test:main src/main/services/agents/services/runtime/` → 137/137
- [x] `pnpm exec tsgo --noEmit -p tsconfig.node.json` → clean for the 3 files
- [x] `pnpm exec biome check` on the 3 files → clean
- [x] grep `protocol: "auto"` in src/+packages/ → only negative test assertion
- [x] No source changes required (fix already present)

Done gate: runtime suite green, tsgo clean, biome clean.
