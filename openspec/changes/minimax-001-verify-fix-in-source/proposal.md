# minimax-001-verify-fix-in-source

## Purpose

Re-verify that the MiniMax Agent protocol fix is intact in source.

## Scope

This is a verification change. It does not require source edits unless a regression is found.

## Success Criteria

- Runtime protocol tests pass.
- Typecheck and format/lint checks pass for the runtime protocol files.
- No live source path emits `protocol: "auto"` for MiniMax.

## Notes

This change is already complete in the KBD progress record.
