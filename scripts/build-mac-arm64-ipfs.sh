#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

export IPFS_API_URL="${IPFS_API_URL:-https://ipfs.prometheusags.ai}"

if [[ -n "${BUN_INSTALL:-}" && -d "$BUN_INSTALL/bin" ]]; then
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

echo "[build:mac:arm64:ipfs] Building managed runtime artifacts"
pnpm runtimes:build

echo "[build:mac:arm64:ipfs] Publishing managed runtime artifacts to ${IPFS_API_URL}"
pnpm runtimes:publish:ipfs

echo "[build:mac:arm64:ipfs] Building Electron app"
pnpm run build

echo "[build:mac:arm64:ipfs] Packaging macOS arm64 app"
pnpm exec electron-builder --mac --arm64
