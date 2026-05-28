# Assessment — Upstream 1.9.x Merge Strategy

**Phase:** upstream-1.9.x-merge-strategy
**Date:** 2026-05-28
**Author:** Claude Code (kbd-assess)
**Goal:** Merge upstream `CherryHQ/cherry-studio` 1.9.x (now at v1.9.7) into this fork
without losing fork-only capabilities or reverting the **The Boss** branding.

---

## 1. Divergence Snapshot

| Fact | Value |
|---|---|
| Merge-base | `b1d63a3bb` (the prior upstream/main, already integrated) |
| Fork HEAD | `2b9fbae0d` |
| Upstream/main | `1c87a5297` (release **v1.9.7**) |
| Commits fork is **ahead** | **126** |
| Commits upstream is **ahead** | **11** |
| Files changed by upstream since merge-base | **19** |
| Real merge conflicts (trial merge) | **2** |

The heavy upstream integration already happened in `2b9fbae0d` ("merge: integrate
upstream main"). This is a **small incremental catch-up**, not a large rebase.

## 2. The 11 New Upstream Commits

All are `fix:`/`chore:` patches plus the v1.9.7 release — no architectural change:

- `e80b4a4c0` chore: release v1.9.7
- `9b1a65829` fix(aiCore): Gemini-via-non-Gemini provider not treated as native PDF
- `a9ab58932` fix(websearch): align ExaMCP response parser with server field names
- `7334cd4f9` fix(analytics): respect `enableDataCollection` setting in renderer
- `d32cbecfa` fix: Gemini Safety Settings → BLOCK_NONE
- `3f14528d4` fix: keep note toolbar static at top during scroll
- `8d93b382f` fix: add CherryIN DeepSeek 1m suffix
- `4f4a9d828` fix: refresh cached miniapp urls
- `1c87a5297` / `4b56265b9` fix: dashboard/token URL → fragment instead of query string
- `b1eb3a4a6` hotfix(ci): run GitCode sync on signing runner

**Value:** worth taking — real bug fixes (ExaMCP, Gemini PDF, analytics opt-out,
notes toolbar) and model-capability additions. None conflict with fork intent.

## 3. Collision Surface

9 files were modified by **both** sides since the merge-base. 7 of them
**auto-merge cleanly**. Only **2 produce conflicts**:

| File | Conflict | Resolution |
|---|---|---|
| `electron-builder.yml` | `releaseInfo` changelog block + branded `appId`/`productName` | **Keep ours** (`tools.know-me.the-boss` / `The Boss`); merge changelog text — append upstream notes under our branded entry |
| `src/renderer/src/utils/analytics.ts` | upstream adds `enableDataCollection` guard + `source` param to `trackTokenUsage` | **Take upstream** — it is a genuine privacy fix; re-apply any fork-local call sites |

Auto-merged-clean collision files (verify after merge, no manual action expected):
`package.json`, `ConfigManager.ts`, `OpenClawService.ts` (+ test),
`claudecode/utils.ts`, `aiCore/utils/options.ts`, `analytics.test.ts`.

## 4. Fork-Only Capabilities — Risk Assessment

Upstream touched **none** of our fork-unique surface. Zero risk of loss:

| Fork-only asset | Touched by upstream's 11 commits? |
|---|---|
| `services/the-boss-control-plane/` (control plane + admin UI) | ❌ No |
| `src/main/services/agents/services/runtime/` (multi-runtime agent work) | ❌ No |
| `vendor/universal-agent-runtime`, `vendor/codex`, `vendor/opencode` | ❌ No |
| `docs/branding/` (icons, branding guide) | ❌ No |
| In-flight `change-019`..`change-024` (uncommitted runtime work) | ❌ No |

## 5. Branding Footprint

- Canonical identifiers live in `electron-builder.yml`: `appId: tools.know-me.the-boss`,
  `productName: The Boss` (upstream: `com.kangfenmao.CherryStudio` / `Cherry Studio`).
- `package.json` `name` is still `CherryStudio` on **both** sides (not a branding
  collision; upstream only bumped version 1.9.6 → 1.9.7).
- ~40 source/doc files reference `the-boss` / `know-me` / `TheBossDev`; **none** are
  among the 19 files upstream changed, so the merge will not disturb branding.

## 6. Pre-existing Working-Tree State (must handle before merge)

The working tree is **dirty**: in-flight runtime work is modified/untracked
(`change-019`..`change-024`, `ManagedBinaryService`, `RuntimeControlService`, etc.).
A merge cannot start cleanly until this is committed or stashed.

## 7. Recommended Strategy

**Direct merge** (`git merge upstream/main`) — not rebase, not cherry-pick:

1. **Commit or stash** the in-flight runtime changes first (tree must be clean).
2. Create a branch `merge/upstream-v1.9.7` off `main` (never on `v2` per CLAUDE.md).
3. `git merge upstream/main`.
4. Resolve the **2** conflicts:
   - `electron-builder.yml` → keep The Boss `appId`/`productName`; combine changelog.
   - `analytics.ts` → take upstream signature + `enableDataCollection` guard.
5. Verify the 7 auto-merged collision files (`git diff` review).
6. `pnpm install` (lockfile/version bump), then `pnpm lint && pnpm test && pnpm build:check`.
7. Spot-check branding still renders (`The Boss`, appId) and runtime/control-plane
   features still load.

**Why merge over rebase/cherry-pick:** only 11 small upstream commits, only 2
conflicts, and the merge-base relationship is already established from the prior
integration commit. Rebasing 126 fork commits would be high-risk for zero benefit;
cherry-picking 11 commits would lose the merge-base linkage and complicate the next
catch-up. A merge keeps history honest and makes the *next* upstream sync trivial.

## 8. Gaps / Open Items

- [ ] Working tree must be cleaned (commit/stash `change-019`..`change-024`) before merge.
- [ ] Decide whether `package.json` `name: CherryStudio` should also be rebranded
      (out of scope for this merge; currently identical to upstream — no conflict).
- [ ] Re-apply fork-local `trackTokenUsage` call sites if upstream's new `source`
      param changes any signatures the fork relies on.
- [ ] Post-merge: run full `pnpm build:check` (lint + test) per CLAUDE.md.

## 9. Effort Estimate

**Low.** ~2 trivial conflict resolutions + dependency install + verification.
No architectural risk. Fork-only features and branding are fully isolated from the
upstream delta.
