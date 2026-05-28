# merge-003 — Merge upstream/main and resolve conflicts

**Phase:** upstream-1.9.x-merge-strategy
**Depends on:** merge-002
**Risk:** low

## Why

Bring in the 11 upstream v1.9.7 commits (bug fixes + model additions). Trial merge
showed exactly **2** conflicts; the other 7 collision files auto-merge cleanly.

## Tasks

- [ ] `git merge upstream/main` (expect 2 conflicts).
- [ ] Resolve `electron-builder.yml`:
  - Keep `appId: tools.know-me.the-boss` and `productName: The Boss`.
  - Combine the `releaseInfo` changelog: keep the branded "The Boss" entry, fold in
    upstream's v1.9.7 notes (grok-build-0.1, StepFun, ExaMCP, code-viewer, OpenCode).
- [ ] Resolve `src/renderer/src/utils/analytics.ts`:
  - Take upstream `trackTokenUsage({ usage, model, source = 'chat' })` signature.
  - Keep the `if (!store.getState().settings.enableDataCollection) return` guard.
  - Re-apply any fork-local call sites that pass extra args.
- [ ] Review the 7 auto-merged collision files with `git diff --cached`:
  `package.json`, `ConfigManager.ts`, `OpenClawService.ts` (+test),
  `agents/services/claudecode/utils.ts`, `aiCore/utils/options.ts`, `analytics.test.ts`.
- [ ] Stage resolutions; complete the merge commit (`git commit --signoff`, keep
      default merge message or annotate with branding-preservation note).

## Verification

- `git diff --name-only --diff-filter=U` returns empty (no unresolved conflicts).
- `git grep -n "tools.know-me.the-boss" electron-builder.yml` still matches.
- `git grep -n "The Boss" electron-builder.yml` still matches.
- Merge commit present in `git log --oneline -3`.
