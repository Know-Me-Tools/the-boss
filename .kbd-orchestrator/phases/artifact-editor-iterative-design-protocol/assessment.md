# Assessment — Artifact Editor: Iterative LLM Design Protocol

**Phase:** artifact-editor-iterative-design-protocol
**Date:** 2026-05-30
**Author:** Claude Code (kbd-assess)
**Priority:** Cornerstone (user-stated) — React.js + HTMX artifacts must work perfectly,
including post-creation iterative AI design (Lovable / Bolt / Bolt.diy / v0 style).

## Goal (restated)

A working **LLM-driven iterative artifact editor**: create an artifact (React or
HTMX/HTML) → display it → edit it again via natural-language requests → re-display,
repeating across multiple turns until functional → save to the local library. The
loop should be driven by **typed, AG-UI-style streaming chunks** that carry the
patches/content and drive the editor/designer state machine across turns.

## Method

Static code survey of the artifact surface (renderer + main) and the existing
AG-UI / typed-streaming substrate. (No runtime repro this pass — the finding is
structural, see below.)

## Core Finding (HIGH confidence)

**The iterative LLM editor does not exist as a designed feature.** What exists today
is **create-via-chat + display/preview + manual code edit + library save**. The
"believed broken protocol for patches" is more accurately: **there is no
artifact-code patch protocol and no editor state machine at all** — so there is
nothing to fix in place; there is a feature to design and build on top of solid
existing primitives.

### What EXISTS (and is reusable)

| Capability | Where | Notes |
|---|---|---|
| Artifact **preview** (React + HTML) | `src/renderer/src/artifacts/config.ts` (`buildHtmlArtifactPreviewDocument`, `buildReactArtifactPreviewDocument`); `src/main/services/ArtifactService.ts` (bundling, module resolution, bootstrap) | Solid render path; theming, library URLs, access policy. |
| Artifact **display cards/popups** | `components/CodeBlockView/{ArtifactPopup,HtmlArtifactsCard,HtmlArtifactsPopup,ReactArtifactsCard,renderArtifactCard}.tsx` | `ArtifactPopup` = split code/preview viewer + **manual** CodeMirror editor (`editable`, `onSave(code)`). No AI panel. |
| Artifact **library CRUD** | `hooks/useArtifactLibrary.ts` → `window.api.artifacts.{list,save,updateMetadata,fork,delete}` | Note: `ArtifactMetadataPatch` is **metadata** (name/tags), NOT a code diff. |
| Artifact **settings** | `pages/settings/ArtifactSettings/*`, `hooks/useArtifactSettings.ts`, `config.ts` | Theme/CSS/library config. |
| **Typed AG-UI streaming substrate** | `src/main/apiServer/protocols/{canonicalEvents,agUiMapper,versions}.ts`, `routes/agents/handlers/messagesAgUi.ts`, `services/agents/interfaces/AgentStreamInterface.ts`, `RuntimeAgentStream`, `SessionStreamBus` | **The exact primitive to build on.** `CanonicalAgentEvent` already models `run_start / text_delta / a2ui_payload / run_complete / run_error / raw_chunk` and maps to AG-UI + A2A. |

### What is MISSING (the actual fault)

1. **No artifact-editor / designer component.** Greps for
   `ArtifactEditor|ArtifactCreator|ArtifactDesigner|editArtifact|iterateArtifact|artifactPatch`
   return nothing. `ArtifactPopup` is a viewer + manual editor — no prompt input, no
   AI iteration, no streaming consumer.
2. **No artifact code-patch protocol.** Nothing applies an LLM-produced diff/patch to
   artifact source. The only "patch" is `ArtifactMetadataPatch` (metadata). No
   choice made between full-rewrite vs unified-diff vs structured edit ops, and no
   apply/validate/rollback.
3. **No editor state machine.** No model of the multi-turn cycle
   (`idle → prompting → streaming → applying → building/validating → preview →
   error/repair → save`). The AG-UI substrate exists but is wired to **agent
   sessions**, not to an artifact-design loop.
4. **No build/validate feedback loop.** `ArtifactService` can bundle/preview, but
   there's no path that feeds a build/runtime error back into the next LLM turn
   (the "edit again until functional" core of Lovable/Bolt/v0).
5. **No typed artifact stream events.** `CanonicalAgentEvent` has no
   artifact-specific kinds (e.g. `artifact_full`, `artifact_patch`, `build_status`,
   `artifact_saved`), so the designer cannot consume typed chunks today.

## Reasoning Chain (per the meta-cognition format)

```
+-- Layer 1: Symptom — "iterative artifact editor is broken; patches don't work"
|       ^
+-- Layer 3: Domain — AG-UI / typed agent streaming (apiServer/protocols, RuntimeAgentStream)
|   Constraint: a multi-turn generative-UI editor needs a typed event protocol +
|   a state machine that consumes those events; patches must apply deterministically
|   to a known base version (optimistic-concurrency / base-hash) or they corrupt state.
|   Rule: AG-UI separates transport (SSE) from protocol (typed events) from state
|   (reducer) — the editor must do the same.
|       v
+-- Layer 2: Design decision
    The feature was built as render+manual-edit, skipping the protocol + state-machine
    layer. Fix = design the artifact-design protocol as artifact-specific
    CanonicalAgentEvent kinds + an editor reducer, reusing the existing AG-UI mapper
    and ArtifactService preview/build — not patch a broken patch consumer (there is none).
```

## Domain Constraints (why this shape)

From the existing AG-UI substrate (`canonicalEvents.ts`, `agUiMapper.ts`):
- **Typed events over raw text** — the renderer must not regex chat text to find code;
  the model/agent must emit typed chunks the editor reducer consumes. This is the
  user's explicit ask and the substrate already supports adding event kinds.
- **Patch determinism** — applying an LLM edit requires a known **base** (artifact
  version + content hash). Lovable/Bolt/v0 either send full files or
  base-anchored diffs and validate before committing. Without a base anchor,
  streamed patches corrupt state across turns — the most likely "it broke" cause once
  any patching was attempted.
- **Build-in-the-loop** — "until functional" requires feeding `ArtifactService`
  build/runtime errors back as a typed `build_status` event into the next turn.

## Open Questions

### DECIDED (user, 2026-05-30)

- ✅ **Edit transport:** **Full-file rewrite per turn first** — each turn the model
  returns the complete artifact file(s); editor swaps + rebuilds. Robust, no
  base-drift corruption. Base-anchored unified diffs are a LATER token-efficiency
  optimization, not the first build.
- ✅ **Edit engine + loop owner:** **Chat model via structured output / tool**,
  **renderer-orchestrated** loop (apply → preview → build-feedback). Reuse existing
  model plumbing; model the typed AG-UI-style events on top of this — NOT a dedicated
  agent-runtime session for v1.

### STILL OPEN (resolve in brainstorming/design)

- [ ] **Single-file vs project:** is a React artifact one file or a small project
      tree? Determines content payload shape + preview/build. (HTMX likely single-file.)
- [ ] **Designer surface:** extend `ArtifactPopup` into a 3-pane designer
      (chat │ code │ preview) vs a dedicated window. (Multi-window infra exists.)
- [ ] **Typed-event shape:** exact artifact `CanonicalAgentEvent` kinds + whether they
      flow through the real AG-UI mapper or a lighter renderer-local typed channel
      (since the loop is renderer-orchestrated, a renderer-local typed event stream
      may suffice — confirm in design).

## Recommended Next Step

This is a **design-heavy feature build**, not a bug patch — so the Plan phase should
begin with **brainstorming/design** (resolve the open questions, choose the protocol
shape) before producing the change list. Proposed direction to validate in Plan:

1. Define artifact-design **typed events** by extending `CanonicalAgentEvent`
   (`artifact_full`, `artifact_patch{baseHash,ops}`, `build_status`, `artifact_saved`)
   + AG-UI mapping.
2. Build an **editor state machine/reducer** in the renderer that consumes those
   events (idle→streaming→applying→building→preview→repair→save).
3. Choose patch strategy (recommend **start with full-file rewrite per turn** for
   correctness, add base-anchored diffs later for token efficiency).
4. Build the **designer surface** (chat + code + preview) reusing `ArtifactService`
   preview/build + `useArtifactLibrary` save.
5. Close the **build-in-the-loop** by feeding build errors back as typed events.

## Effort Estimate

**Medium–high.** The render/preview/library/AG-UI primitives are solid (big head
start), but the protocol, state machine, designer UI, and build-feedback loop are
net-new and design-sensitive. Strongly recommend brainstorming → design doc →
phased change list, built TDD with the two-stage review (this is exactly the
multi-turn-state class where that loop catches real bugs).

## Gaps / Open Items

- [ ] Confirm with the user the 5 open questions above (Plan/brainstorm phase).
- [ ] Verify the current "create artifact" path end-to-end (how a chat code block
      becomes an artifact card today) — read `renderArtifactCard.tsx` + `MainTextBlock`.
- [ ] Decide reuse vs rebuild of `ArtifactPopup` for the designer surface.
