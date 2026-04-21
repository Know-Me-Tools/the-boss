# Building Universal Agent Runtime

Universal Agent Runtime is distributed as an optional sidecar binary.

## Source

```sh
git submodule update --init vendor/universal-agent-runtime
git -C vendor/universal-agent-runtime checkout c7c8416b94d39358ec7cf03691738426c25b2df8
```

## Build

```sh
pnpm uar:build:sidecar
```

The build script runs:

```sh
cargo build --release --locked
```

from `vendor/universal-agent-runtime`. If the pinned submodule's lockfile is stale, the script runs
`cargo generate-lockfile` once and retries the locked build so the final binary is still produced by
`cargo build --release --locked`. Set `UAR_REFRESH_LOCKFILE=0` to disable the automatic lockfile
refresh and fail fast instead.

After the locked build succeeds, the script copies the compiled binary to:

```text
resources/binaries/<platform-arch>/universal-agent-runtime
```

It also writes `resources/binaries/<platform-arch>/.uar-version` with the source commit, crate version, platform key, and build timestamp.

Each release builder is expected to build the binary for its own target platform and architecture.
