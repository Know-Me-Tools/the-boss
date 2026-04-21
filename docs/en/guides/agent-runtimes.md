# Agent Runtimes

The agent runtime setting selects which execution backend handles an agent session. Runtime choice is stored on the agent or session configuration under `configuration.runtime`.

## Runtime Types

| Runtime | Mode | Main Use | Notes |
|---|---|---|---|
| Claude | `managed` | Native Claude Agent SDK execution | Supports compaction, approvals, tool use, MCP, skills, knowledge, file access, shell access, and session resume. |
| Codex | `managed` | OpenAI Codex SDK execution | Requires an OpenAI-compatible provider. Supports workspace sandboxing, approvals, tools, MCP, skills, knowledge, file access, shell access, and session resume. Does not support Claude SDK compaction. |
| OpenCode | `managed`, `remote` | OpenCode server execution | Managed mode starts the pinned embedded `opencode serve` executable and reuses it across turns. Remote mode connects to an existing OpenCode endpoint. Does not support Claude SDK compaction. |
| UAR | `embedded`, `remote` | Universal Agent Runtime sidecar execution | Embedded mode resolves an explicit path, `UAR_SIDECAR_PATH`, a verified managed binary, then the bundled fallback. Remote mode connects to an existing UAR endpoint. UAR currently reports degraded approval, resume, and compaction support. |

The compatibility resolver must remain the source of truth for degraded support. Do not document a runtime as lossless if `resolveRuntimeCompatibility` returns warnings.

## Configuration Fields

Common fields:

- `kind`: `claude`, `codex`, `opencode`, or `uar`.
- `mode`: runtime mode. Claude and Codex use managed modes; OpenCode supports managed or remote; UAR supports embedded or remote.
- `endpoint`: required for OpenCode remote mode and UAR remote mode.
- `profileId`: optional runtime profile identifier.
- `modelId`: optional model override for the runtime session.
- `sandbox.mode`: Codex sandbox mode, such as `read-only`, `workspace-write`, or `danger-full-access`.
- `sandbox.networkAccess`: enables network access where the runtime supports it.
- `permissions.mode`: runtime approval mode. Codex and OpenCode map this to their own approval systems. UAR currently reports approval support as degraded.
- `sidecar.binaryPath`: optional UAR sidecar binary override. `UAR_SIDECAR_PATH` can also override the embedded binary path.
- `skills.enabled`: enables runtime skill bridge materialization for non-Claude runtimes.

## Sidecar Setup

### OpenCode

OpenCode is vendored at `vendor/opencode`, but the app intentionally does not package OpenCode as a runtime Node dependency. Managed OpenCode uses a pinned executable resource built from the vendored source and launched as a local server:

```bash
pnpm opencode:build:runtime
```

The vendored OpenCode build currently requires Bun 1.3.11 or newer.

The build runs:

```bash
bun run --cwd vendor/opencode/packages/opencode build --single --skip-embed-web-ui
```

Then it copies the current-platform binary into:

```text
resources/opencode/<platform-arch>/opencode
```

On Windows the executable name is `opencode.exe`. The `resources/**/*` packaging rule includes this artifact, and `resources/**` is unpacked from ASAR so Electron can spawn it. OpenCode CLI packages should not be added to runtime external dependency packaging; the executable is a resource artifact.

Managed execution starts:

```bash
opencode serve --hostname 127.0.0.1 --port 0
```

The main process passes runtime overrides through `OPENCODE_CONFIG_CONTENT`, parses the server URL from stdout, and creates an SDK client with `createOpencodeClient({ baseUrl })`. The app uses the public OpenCode SDK/server surface for configuration, provider/model discovery, agents, sessions, prompts, permissions, and events. This matches the official architecture: `opencode serve` exposes the OpenAPI server used by clients, and the JS/TS SDK is a type-safe client for that server.

The in-process vendored-source path is intentionally rejected for this phase. It would depend on private OpenCode internals rather than the stable SDK/server API, increasing maintenance risk whenever the vendored submodule changes.

OpenCode config precedence for this integration:

```text
global ~/.config/opencode/opencode.json or opencode.jsonc
OPENCODE_CONFIG / OpenCode-managed project discovery
project opencode config and .opencode directories
OPENCODE_CONFIG_CONTENT runtime overrides
```

The runtime model picker uses `client.config.get()` and `client.config.providers()` as the source of truth. Model IDs are stored as canonical `provider/model` strings. When no usable machine-level OpenCode provider/model config exists, the main process creates `~/.config/opencode/opencode.json` from enabled Cherry providers and models, then lets the OpenCode server load that config.

### UAR

UAR is vendored at `vendor/universal-agent-runtime` and pinned by `UniversalAgentRuntimeService.UAR_EXPECTED_COMMIT`.

Build the current platform sidecar before using embedded UAR:

```bash
pnpm uar:build:sidecar
```

The build writes:

```text
resources/binaries/<platform-arch>/universal-agent-runtime
resources/binaries/<platform-arch>/.uar-version
```

AGPL notice and build details live under `resources/licenses/universal-agent-runtime/`.

## Managed Binary Updates

The embedded UAR sidecar can be supplied as a managed binary under app data:

```text
Data/managed-binaries/universal-agent-runtime/<version>/<platform-arch>/universal-agent-runtime
```

Managed binaries are only used after manifest validation passes. The installer verifies platform support, expected file size, and SHA-256 before renaming the downloaded file into the final executable path. Failed verification leaves the managed binary unavailable and prevents silent execution of a mismatched file.

Each manifest entry may include an optional `ipfsCid`, but IPFS is never the only required transport. The installer attempts IPFS gateway URLs first when a CID is present, keeps HTTPS as fallback, and applies the same max-size and SHA-256 validation regardless of which transport succeeds.

Resolution order for embedded UAR is:

```text
sidecar.binaryPath -> UAR_SIDECAR_PATH -> verified managed binary -> bundled fallback
```

The Runtime Settings panel shows the current source as configured path, environment path, managed binary, or bundled fallback. Missing, unsupported, failed verification, failed download, and update-available states are shown separately from ready/running states. The install/update action calls the managed-binary backend and keeps the bundled fallback in place for offline use during this transition.

Do not remove the bundled UAR fallback from production packaging until managed install/update reliability is proven by smoke tests across supported platforms.

Operators can generate manifest entries for UAR, RTK, or future helper binaries with:

```bash
node scripts/build-managed-binary-manifest.js \
  --name universal-agent-runtime \
  --version c7c8416b94d39358ec7cf03691738426c25b2df8 \
  --source-commit c7c8416b94d39358ec7cf03691738426c25b2df8 \
  --binary darwin-arm64=resources/binaries/darwin-arm64/universal-agent-runtime \
  --https-url darwin-arm64=https://example.com/universal-agent-runtime-darwin-arm64 \
  --ipfs-cid darwin-arm64=bafy... \
  --out dist/managed-binaries/universal-agent-runtime.manifest.json
```

The generated manifest records platform, binary name, size, max size, SHA-256, HTTPS URL, and optional CID fields. Release publishing should upload the binary artifact to HTTPS storage first, optionally pin it to IPFS, then publish the manifest after smoke tests pass.

## Runtime Skill Bridge

Claude uses the existing `.claude/skills` workspace symlink behavior. Codex, OpenCode, and UAR use the runtime skill bridge to materialize selected skills into runtime-specific paths before execution.

Skill selection precedence:

```text
global -> agent -> session
```

The preflight requires the default Prometheus KBD skills to be installed. Missing required skills block runtime execution with a readable error.

## Chat Telemetry

Runtime adapters emit `data-agent-runtime-*` stream parts. The renderer converts them into `runtime.event` chunks and a runtime message block. The block shows runtime identity, latest event, session id, known model/provider/mode metadata, approval choices when present, and a collapsed debug payload for raw runtime data.

## Smoke Checklist

Run from the current 1.9.x branch. Do not use `v2`.

1. Build or verify dependencies:
   ```bash
   pnpm install
   pnpm opencode:build:runtime
   pnpm uar:build:sidecar
   ```
2. Run validation gates:
   ```bash
   pnpm format
   pnpm lint
   pnpm test
   ```
3. Claude managed session:
   - Select runtime `claude`, mode `managed`.
   - Run a prompt that uses an allowed tool and an enabled skill.
   - Verify text output, skill context, tool blocks, and session resume still work.
4. Codex managed session:
   - Select runtime `codex`, mode `managed`.
   - Use an OpenAI-compatible model override.
   - Verify runtime telemetry shows `codex`, sandbox/approval metadata, session id, tool events, and token usage.
5. OpenCode managed session:
   - Select runtime `opencode`, mode `managed`.
   - Verify binary resolution points at `resources/opencode/<platform-arch>/opencode` or the ASAR-unpacked equivalent in a packaged build.
   - Verify `opencode serve` starts and `client.config.providers()` returns providers/models.
   - Verify invalid OpenCode model selections default to the server-reported default or the first visible model.
   - Run two turns in the same session.
   - Verify the managed server is reused, session id persists, and permission events render as approval UI.
   - Verify a permission response is delivered back to the OpenCode server.
   - In a packaged build, verify the spawned path is under `app.asar.unpacked`, not inside `app.asar`.
6. OpenCode remote session:
   - Start an OpenCode-compatible endpoint.
   - Select runtime `opencode`, mode `remote`, and set `endpoint`.
   - Verify remote config update succeeds and auth headers are sent when configured.
7. UAR embedded session:
   - Select runtime `uar`, mode `embedded`.
   - Verify the sidecar starts from `resources/binaries/<platform-arch>/universal-agent-runtime`.
   - Verify `/v1/models` discovery and streamed chat response telemetry render in chat.
8. UAR remote session:
   - Start a UAR-compatible endpoint.
   - Select runtime `uar`, mode `remote`, and set `endpoint`.
   - Verify remote chat execution works without launching the embedded sidecar.

Record any failed gate with the command, log excerpt, suspected owner scope, and whether it is a repo-wide blocker or runtime-specific blocker.
