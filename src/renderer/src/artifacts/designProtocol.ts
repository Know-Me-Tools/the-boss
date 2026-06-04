import type { ArtifactSourceLanguage } from '@shared/artifacts'
import { ArtifactSourceLanguageSchema } from '@shared/artifacts'
import * as z from 'zod'

export type { ArtifactSourceLanguage } from '@shared/artifacts'

// ---------------------------------------------------------------------------
// ArtifactDesignEvent — discriminated union for design-run lifecycle events.
//
// Naming mirrors CanonicalAgentEvent (run_start / text_delta / run_complete /
// run_error in src/main/apiServer/protocols/canonicalEvents.ts) so a later
// promotion to the real AG-UI mapper is mechanical. NOTE for that promotion:
// `design_run_start` and `artifact_text_delta` deliberately diverge in their
// fields from their canonical counterparts (turnId/baseVersionHash here vs.
// threadId/runId/messageId/isCumulative there) — the promotion layer must
// re-map those fields, not just strip the `design_`/`artifact_` prefix.
//
// Protocol ordering for a single turnId: `design_run_start` →
// zero-or-more `artifact_text_delta` → exactly one `artifact_full` (the full
// file; it MAY arrive with no preceding deltas on the structured-output path)
// → `build_status` → optional `artifact_saved` → `design_run_complete`.
// `design_run_error` may terminate a turn at any point.
// ---------------------------------------------------------------------------

export type ArtifactDesignEvent =
  | { kind: 'design_run_start'; turnId: string; baseVersionHash: string | null }
  | { kind: 'artifact_text_delta'; turnId: string; text: string }
  | { kind: 'artifact_full'; turnId: string; source: string; language: ArtifactSourceLanguage }
  | {
      kind: 'build_status'
      turnId: string
      ok: boolean
      diagnostics: readonly string[]
      errors: readonly { readonly text: string }[]
    }
  | { kind: 'artifact_saved'; turnId: string; recordId: string; versionHash: string }
  | { kind: 'design_run_complete'; turnId: string }
  | { kind: 'design_run_error'; turnId: string; message: string }

// ---------------------------------------------------------------------------
// ArtifactDesignTurnPayloadSchema — structured-output payload the model
// returns each turn. Validated at the boundary before emitting events.
// ---------------------------------------------------------------------------

export const ArtifactDesignTurnPayloadSchema = z.object({
  source: z.string().min(1),
  language: ArtifactSourceLanguageSchema,
  notes: z.string().optional()
})

export type ArtifactDesignTurnPayload = z.infer<typeof ArtifactDesignTurnPayloadSchema>

// ---------------------------------------------------------------------------
// versionHash — deterministic, pure, synchronous content hash.
// Uses FNV-1a (32-bit) for its simplicity and good distribution.
// NOT a cryptographic primitive — only used as a turn/version anchor.
//
// Strings are hashed as UTF-16 code units (JavaScript native); a surrogate
// pair is processed as two separate code units. Fully deterministic for a
// given string, but values WILL differ if ported to a UTF-8 context
// (e.g. Node Buffer / TextEncoder).
// ---------------------------------------------------------------------------

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

export function versionHash(source: string): string {
  let hash = FNV_OFFSET_BASIS

  for (let i = 0; i < source.length; i++) {
    // FNV-1a: XOR then multiply. Each UTF-16 code unit contributes its low
    // and high byte so BMP and surrogate code units both affect the hash.
    const code = source.charCodeAt(i)
    hash ^= code & 0xff
    hash = Math.imul(hash, FNV_PRIME) >>> 0
    hash ^= (code >>> 8) & 0xff
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}
