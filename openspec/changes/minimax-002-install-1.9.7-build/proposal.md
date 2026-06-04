# minimax-002-install-1.9.7-build

## Purpose

Install the 1.9.7 build that contains the MiniMax Agent protocol fix.

## Scope

This is a delivery/manual validation change. It installs the built macOS arm64 artifact and confirms the running app is not the stale 1.9.4 build.

## Success Criteria

- `The Boss.app` launches from the installed 1.9.7 build.
- The app reports version `1.9.7`.
- Gatekeeper/quarantine is handled for the ad-hoc signed local build.

## Notes

The mac arm64 artifact was built locally and ad-hoc signed because duplicate Apple Development identities made named certificate signing ambiguous.
