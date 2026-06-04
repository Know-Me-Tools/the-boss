# minimax-005-push-and-open-draft-pr

## Purpose

Publish the MiniMax Agent protocol branch and open a draft PR after live proof passes.

## Scope

This is a delivery change gated by the live MiniMax smoke test unless the user explicitly overrides the gate.

## Success Criteria

- Branch is pushed.
- Draft PR is opened with the `gh-create-pr` skill.
- PR targets `Know-Me-Tools/the-boss` `main`.
- PR does not target or use `v2`.
- PR includes verification evidence and build/signing notes.
