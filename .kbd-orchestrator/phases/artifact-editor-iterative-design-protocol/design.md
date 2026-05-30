# Design — Artifact Editor: Iterative LLM Design Protocol

**Phase:** artifact-editor-iterative-design-protocol
**Date:** 2026-05-30
**Author:** Claude Code (kbd-plan)
**Inputs:** [assessment.md](./assessment.md), [progress.json](./progress.json)
**Base:** current 1.9.x line (per CLAUDE.md — never v2)

## Purpose

Resolve the 3 open design questions from the assessment and fix the protocol/state
shape so the ordered change list is unambiguous. This is a **design-heavy feature
build**, not a bug patch — the iterative LLM editor does not exist yet; we build it
on top of solid existing primitives (preview builders, `ArtifactService`
bundle/compile, library CRUD, and the AG-UI typed-event vocabulary).

## Locked decisions (carried from assessment)

- **Edit transport:** full-file rewrite per turn first. The model returns the
  complete artifact file each turn; the editor swaps + rebuilds. No base-anchored
  diffs in v1 (deferred token-efficiency optimization). Avoids base-drift corruption.
- **Edit engine + loop owner:** chat model via **structured output / tool call**,
  **renderer-orchestrated** loop (prompt → apply → preview → build-feedback). Reuse
  existing model plumbing; model the typed AG-UI-style events on top. NOT a dedicated
  agent-runtime session for v1.

## Decisions resolved this phase (user, 2026-05-30)

1. **Artifact shape (v1): single-file.** One self-contained source per artifact —
   `tsx`/`jsx` for React, one `.html` for HTMX. Matches existing
   `ArtifactService.compileReactArtifact` (already rejects relative imports:
   *"Relative imports are not supported in single-file React artifacts"*) and the
   single-`source` shape of `ArtifactRecord`. Multi-file project tree is a later phase.

2. **Designer surface (v1): extend `ArtifactPopup` into a 3-pane designer**
   (chat │ code │ preview). Reuse its CodeMirror editor, preview iframe, and save
   wiring. Lowest-risk path to a working loop. No new window lifecycle in v1.

3. **Event channel (v1): renderer-local typed channel.** Because the loop is
   renderer-orchestrated, define artifact events as a **renderer-local typed stream
   + reducer**. Do NOT modify the main-process `CanonicalAgentEvent` / `agUiMapper`
   in v1. BUT: name the kinds to mirror the canonical vocabulary so a later promotion
   to the real AG-UI mapper is mechanical.

## Protocol — typed artifact-design events (renderer-local)

A discriminated union consumed by the editor reducer. Names deliberately mirror
`CanonicalAgentEvent` (`run_start`/`text_delta`/`run_complete`/`run_error`) so the
later AG-UI promotion is a rename + transport swap, not a redesign.

```ts
type ArtifactDesignEvent =
  | { kind: 'design_run_start'; turnId: string; baseVersionHash: string | null }
  | { kind: 'artifact_text_delta'; turnId: string; text: string }            // streaming source
  | { kind: 'artifact_full'; turnId: string; source: string; language: ArtifactSourceLanguage } // full-file result
  | { kind: 'build_status'; turnId: string; ok: boolean; diagnostics: readonly string[]; errors: readonly { readonly text: string }[] }
  | { kind: 'artifact_saved'; turnId: string; recordId: string; versionHash: string }
  | { kind: 'design_run_complete'; turnId: string }
  | { kind: 'design_run_error'; turnId: string; message: string }
```

- `baseVersionHash` anchors each turn to the artifact version it edited — even though
  v1 swaps the whole file, recording the base hash makes later base-anchored diffs and
  rollback trivial and prevents a stale turn from clobbering a newer edit.
- `build_status` is produced by feeding `ArtifactService.compileReactArtifact`'s
  `{ diagnostics, errors }` (React) or an HTML validation pass back into the loop.
- (change-001) `build_status` arrays are `readonly` to keep events immutable across
  handler boundaries; `language` uses the shared `ArtifactSourceLanguage` type.

## State machine — editor reducer (renderer)

```
idle
  → prompting        (user submits NL request)
  → streaming        (consume artifact_text_delta / artifact_full)
  → applying         (swap source into editor model, anchored to baseVersionHash)
  → building         (compile React via ArtifactService / validate HTML)
  → preview          (build ok → render iframe)        ──┐
  → repair           (build failed → build_status fed to next turn) ──┘ loops to prompting
  → saving           (user accepts → useArtifactLibrary.save, new version)
  → idle
error → surfaced, recoverable back to prompting
```

Determinism rule: every transition that mutates source records the resulting
`versionHash`; the next `design_run_start` must carry the current head hash as
`baseVersionHash`. (Full-file swap in v1, but the anchor is in the protocol from day one.)

## Build-in-the-loop seam (already exists)

`ArtifactService.compileReactArtifact(input): Promise<CompileReactArtifactResponse>`
returns `{ code, diagnostics, errors }`. That is the `build_status` payload. HTML
artifacts get a lighter validation pass (parse + sandboxed load signal). This closes
"edit again until functional" without new main-process infrastructure.

## Reuse map (what each change builds on)

| Need | Reuse |
|---|---|
| Preview render | `buildReactArtifactPreviewDocument` / `buildHtmlArtifactPreviewDocument` (`artifacts/config.ts`), `ArtifactService` bootstrap |
| Build/validate | `ArtifactService.compileReactArtifact` (React); HTML validate pass (new, light) |
| Library save / version | `useArtifactLibrary` → `window.api.artifacts.{save,updateMetadata,fork}`, `ArtifactVersion` schema in `@shared/artifacts` |
| Designer shell | `ArtifactPopup` (CodeMirror `editable`+`onSave`, preview iframe, Splitter) |
| Event vocabulary | mirror `CanonicalAgentEvent` kinds (`protocols/canonicalEvents.ts`) — renderer-local copy in v1 |
| Source language detect | `parseArtifactLanguage` / `resolveArtifactDescriptor` (`renderArtifactCard.tsx`) |

## Out of scope (v1)

- Multi-file project artifacts.
- Base-anchored unified diffs / structured edit ops (protocol keeps the hash anchor ready).
- Routing through the real main-process AG-UI mapper / agent-runtime sessions.
- Dedicated designer window.

## Build discipline

TDD with the two-stage review (this is the multi-turn-state class where the loop
catches real bugs). Reducer + protocol are pure and must be unit-tested before UI.
Per CLAUDE.md: route logging through `loggerService`, i18n all UI strings, no new
Redux slices / Dexie schema changes without approval (none required here — artifact
library already persists via `window.api.artifacts`).
