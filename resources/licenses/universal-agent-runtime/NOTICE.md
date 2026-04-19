# Universal Agent Runtime Notice

The Boss includes optional sidecar support for Universal Agent Runtime.

- Source repository: `git@github.com:Prometheus-AGS/universal-agent-runtime.git`
- Pinned source commit: `c7c8416b94d39358ec7cf03691738426c25b2df8`
- Package name: `universal-agent-runtime`
- License: AGPL-3.0-only

The sidecar is optional. The application can start and run without the binary. When packaged, the sidecar binary is built from the source commit listed above and copied to `resources/binaries/<platform-arch>/universal-agent-runtime`.

The complete AGPL-3.0 license text is included in `LICENSE` in this directory. Source code is available from the repository above and from the vendored submodule at `vendor/universal-agent-runtime`.
