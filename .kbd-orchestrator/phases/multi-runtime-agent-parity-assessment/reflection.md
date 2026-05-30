# Reflection — multi-runtime-agent-parity-assessment

**Phase:** multi-runtime-agent-parity-assessment
**Status:** execution_complete (24/24 changes DONE)
**Date:** 2026-05-30
**Author:** Claude Code (kbd-reflect)

> Final phase reflection covering all 24 changes. The earlier mid-phase
> reflection (changes through ~021) is preserved as
> `reflection-2026-04-18-midphase.md`.

## Objective

Assess, plan, and execute the implementation needed to configure and run Claude,
Codex, OpenCode, and Universal Agent Runtime (UAR) on the current 1.9.x codebase.

## Goal Achievement

| Goal | Status |
|---|---|
| Run all four runtimes (Claude, Codex, OpenCode, UAR) on 1.9.x | ✅ MET — runtime model, settings UI, execution settings, context pipeline, per-runtime parity (changes 001–008). |
| Skill + knowledge bridge for non-Claude runtimes | ✅ MET — change-005. |
| Runtime control plane, session bindings, approval flow | ✅ MET — changes 010–012. |
| Validation hardening + Electron smoke | ✅ MET — changes 009, 013. |
| Managed binary distribution (core, resolution, UI, IPFS/IPNS/DNSLink) | ✅ MET — changes 014–021. |
| Managed-binary trust order (verified-before-PATH) | ✅ MET — change-022. |
| Sidecar process supervision (observability, idle/restart limits, cleanup) | ✅ MET — change-023. |
| Runtime release matrix (archives, signed manifest, gates) | ✅ MET — change-024. |

**Overall: 24/24 changes DONE. All phase goals MET.**

## Delivered Changes

All 24 changes reached `DONE` in `progress.json`:

- **001–008** runtime model, settings UI, UAR execution settings, context pipeline,
  skill/knowledge bridge, Codex parity, OpenCode parity, chat telemetry.
- **009–013** validation hardening, control plane, session bindings, approval flow,
  UAR electron smoke.
- **014–021** package scope/size fix, managed-binary core, UAR managed-binary
  resolution, managed-binary UI/docs, IPFS transport release workflow, signed
  runtime channel manifest, IPNS/DNSLink publish, on-demand install policy.
- **022** managed-binary resolution trust order (verified managed binary before
  opt-in PATH discovery; PATH discovery default-off).
- **023** sidecar process supervisor (detached process groups, pidusage sampling,
  idle shutdown, restart budget/backoff, SIGTERM→SIGKILL via tree-kill,
  shutdownAll on app-quit; UAR + OpenCode routed through it; status IPC + UI).
- **024** runtime release matrix (platform matrix, byte-reproducible tar.zst/zip
  archives, Zod manifest schema, per-platform merge, release-completeness gate +
  dry-run, env-gated macOS sign/notarize, docs).

### Landed to `main` this session (PRs)

| PR | Content | State |
|---|---|---|
| #13 | Upstream Cherry Studio v1.9.7 merge | merged |
| #14 | change-022 managed-binary trust order | merged |
| #15 → #16 | change-023 sidecar supervisor (recovered via #16 after a stacked-PR mishap stranded it off `main`) | merged |
| #17 | change-024 runtime release matrix | merged |

## Artifact Quality Summary

| Metric | Value |
|---|---|
| Changes DONE | 24/24 |
| Changes with artifact-refiner QA log | 1 (change-001) |
| Changes with `qa.status: passed` (refiner) | 6 (001, 009–013) |
| Changes with `qa.status: skipped` | 15 |
| Changes 022–024 QA method | subagent-driven two-stage review (spec + code-quality) per task |

**Note on QA tooling:** the formal artifact-refiner gate is wired only for
change-001 (`.refiner/artifacts/change-001-runtime-agent-model/`); there is no
`.kbd-orchestrator/constraints.md` and no `/refine-validate` command in this repo,
so most earlier changes recorded `qa: skipped`. Changes 022–024 substituted a
**subagent-driven TDD review loop** (implementer → spec-compliance review →
code-quality review → fix, per task) that exceeded a skipped refiner gate and
caught real defects (see Lessons).

### Recurring constraint violations

Not measurable via artifact-refiner (only change-001 has a log). From the 022–024
review loop, the recurring *defect classes* were async-lifecycle races and
release-gate completeness holes (see Lessons), not style/lint constraints.

## Technical Debt Introduced

- **artifact-refiner not wired**: 15 changes recorded `qa: skipped`. A future phase
  should either wire `constraints.md` + `/refine-validate` or formally adopt the
  subagent two-stage review as the QA gate of record.
- **Native KBD changes not archived**: the 24 change files remain under
  `.kbd-orchestrator/changes/` rather than `.kbd-orchestrator/changes/archive/<date>-<id>/`.
- **CI-bound paths env-gated, not exercised here**: change-024's 6-platform
  cross-compile and real macOS sign/notarize run only on native CI runners; they
  are fixture-tested but have not run end-to-end against real Apple creds / all
  targets. The first real CI release run is the validation.
- **OpenCode/UAR auto-restart semantics**: both opt into supervisor auto-restart;
  OpenCode's on-demand keyed-server model needed a generation-guard to avoid
  eviction races. Worth revisiting whether on-demand servers should opt out of
  auto-restart entirely (a per-spawn `autoRestart` flag).
- **`pnpm build:mac:arm64` verification deferred**: documented as CI-only; not run.

## Lessons Captured

1. **The two-stage review loop earns its cost on integration + async code.** Across
   022–024 it caught ~14 real bugs that passing tests alone would not: post-exit
   sampling races, a concurrent-stop timer leak (orphaned SIGKILL to a recycled
   pid), pidless-entry state stranding, stop-during-restart corruption, UAR
   stale-status/double-spawn races, an OpenCode restart-eviction race, React unmount
   races, a manifest schema silently stripping security-critical trust fields, a UAR
   matrix-validation dead-letter (display-name vs key), and three release-gate
   bypasses (unknown name / array signature / empty release).

2. **Display-name vs key mismatches are a recurring hazard.** The build pipeline
   emits `universal-agent-runtime` while the matrix keys on `uar`; this silently
   disabled UAR validation until caught. Centralizing `resolveRuntimeKey` in the
   matrix module fixed it once for all consumers (gates, merge, signing).

3. **Security/release gates must fail loudly on the unexpected.** Default-lenient
   gates (skip unknown names, accept any object as a signature, pass on empty input)
   are bypasses triggerable by CI misconfiguration, not just attackers. "Fail on
   anything unexpected" is the correct posture for a release control.

4. **Stacked PRs need merge-order discipline.** change-023 (#15) merged into the
   change-022 branch, but that branch was never re-merged to `main` after #14, so 23
   commits were stranded. Always verify the target branch actually contains the
   work (`git cat-file -e origin/main:<sentinel>`) before building dependent work.

5. **Reproducible artifacts matter for a checksum-publishing pipeline.** Sorting
   archive members, stamping a constant mtime, and zeroing uid/gid made
   `archiveSha256` deterministic — without it, identical builds on different hosts
   would publish different hashes.

6. **Run the broad test sweep, not just the touched file.** A supervisor change
   passed its own tests but broke a sibling smoke test that transitively used the
   real singleton; only a full runtime-dir run caught it.

7. **Watch for raw control bytes in source.** A test fixture embedded a literal NUL
   byte, making the `.ts` file binary to git/tooling. Use escape sequences (`\x00`)
   so source stays plain text.

## Recommended Focus for Next Phase

1. **Validate the release matrix in real CI** — run the 6-platform cross-compile and
   macOS sign/notarize on native runners; confirm the signed channel manifest and
   the release gate behave end-to-end with real Apple credentials.
2. **Wire a real QA gate** — adopt artifact-refiner (`constraints.md` +
   `/refine-validate`) or codify the subagent two-stage review as the standard.
3. **Archive completed changes** — move the 24 change files to
   `.kbd-orchestrator/changes/archive/`.
4. **Revisit on-demand auto-restart** — consider per-spawn `autoRestart: false` for
   OpenCode's keyed on-demand servers instead of the generation-guard.
5. **End-to-end runtime smoke on a packaged build** — managed-binary install →
   supervisor lifecycle → release-manifest verification in a real DMG.

## Branch Policy Compliance

All work stayed on the 1.9.x `main` line per CLAUDE.md. No `v2` checkout, merge,
rebase, or cherry-pick occurred. The Boss branding
(`appId: tools.know-me.the-boss`, `productName: The Boss`) was preserved through the
upstream v1.9.7 merge.
