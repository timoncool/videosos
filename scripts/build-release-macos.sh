#!/bin/bash
# Builds an unsigned (ad-hoc signed) VideoSOS .dmg for Apple Silicon, as the music studios build theirs.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
staging="$root/desktop/src-tauri/staging"

cd "$root"
npm --prefix frontend ci --no-audit --no-fund
npm --prefix frontend run build
cargo test --workspace

rm -rf "$staging"
mkdir -p "$staging/frontend"
cp -r frontend/dist "$staging/frontend/dist"
echo "[OK] bundle staged in $staging"

npm --prefix desktop ci --no-audit --no-fund
cd desktop
npm exec tauri build -- --config src-tauri/tauri.macos-release.conf.json --bundles dmg

find src-tauri/target/release/bundle/dmg -name '*.dmg'
