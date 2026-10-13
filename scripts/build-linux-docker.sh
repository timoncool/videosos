#!/bin/bash
# The Linux x86-64 .deb and AppImage, built on this machine in an Ubuntu 22.04 container (glibc 2.35, so they run
# there and on anything newer; Docker under WSL on Windows) from the committed HEAD, as Dub Studio builds its own.
#   scripts/build-linux-docker.sh <output folder> [cache folder]
# The cache keeps Rust, Node and the cargo target between runs.
set -euo pipefail

if [ "${1:-}" = "--inside" ]; then
  export DEBIAN_FRONTEND=noninteractive APPIMAGE_EXTRACT_AND_RUN=1 RUSTUP_TOOLCHAIN=stable CARGO_TERM_COLOR=never
  export CARGO_HOME=/cache/cargo RUSTUP_HOME=/cache/rustup npm_config_cache=/cache/npm PATH=/cache/cargo/bin:/cache/node/bin:$PATH
  echo "[..] packages"
  apt-get update -q >/dev/null
  apt-get install -y -q --no-install-recommends build-essential pkg-config curl ca-certificates git unzip xz-utils \
    libssl-dev libasound2-dev libwayland-dev libxkbcommon-dev libgtk-3-dev \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev libxdo-dev patchelf file libfuse2 gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav >/dev/null
  if [ ! -x /cache/node/bin/node ]; then
    echo "[..] node 24"
    v=$(curl -s https://nodejs.org/dist/latest-v24.x/ | grep -o 'node-v24[0-9.]*-linux-x64.tar.xz' | head -1)
    mkdir -p /cache/node && curl -sL "https://nodejs.org/dist/latest-v24.x/$v" | tar -xJ -C /cache/node --strip-components=1
  fi
  if [ ! -x /cache/cargo/bin/cargo ]; then
    echo "[..] rust stable"
    curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable >/dev/null
  fi
  echo "[..] source $(git -c safe.directory=/src -C /src rev-parse --short HEAD)"
  rm -rf /cache/src && mkdir -p /cache/src
  git -c safe.directory=/src -C /src archive HEAD | tar -x -C /cache/src
  cd /cache/src
  export CARGO_TARGET_DIR=/cache/target
  mkdir -p desktop/src-tauri
  ln -sfn /cache/target desktop/src-tauri/target
  echo "[..] build (log: build.log)"
  bash scripts/build-release-linux.sh > /out/build.log 2>&1 || { echo "[ERROR] build failed"; tail -40 /out/build.log; exit 1; }
  version="$(node -p "require('./desktop/src-tauri/tauri.conf.json').version")"
  cp "$(find /cache/target/release/bundle/deb -name '*.deb' | head -n 1)" "/out/VideoSOS-${version}-linux-amd64.deb"
  cp "$(find /cache/target/release/bundle/appimage -name '*.AppImage' | head -n 1)" "/out/VideoSOS-${version}-linux-x86_64.AppImage"
  ls -la /out/*.deb /out/*.AppImage
  echo "[OK] VideoSOS ${version} for Linux"
  exit 0
fi

out="${1:?output folder}"
cache="${2:-$HOME/videosos-linux2204-cache}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$out" "$cache"
cp "$repo/scripts/build-linux-docker.sh" "$out/.build-linux-docker.sh"
docker run --rm -v "$repo:/src:ro" -v "$(cd "$out" && pwd):/out" -v "$cache:/cache" ubuntu:22.04 bash /out/.build-linux-docker.sh --inside
