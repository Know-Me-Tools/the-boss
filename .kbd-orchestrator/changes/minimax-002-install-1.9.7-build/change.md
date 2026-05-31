# change-002 — Install the 1.9.7 build (contains the fix)

Phase: minimax-agent-protocol · Type: delivery · Agent: manual/user

## Tasks
- [ ] Open dist/The-Boss-1.9.7-arm64.dmg, drag to /Applications
- [ ] Bypass Gatekeeper: right-click → Open OR `xattr -dr com.apple.quarantine "/Applications/The Boss.app"`
- [ ] Confirm in-app version shows 1.9.7 (prior failing app was 1.9.4)

Done gate: app reports 1.9.7 and launches.
