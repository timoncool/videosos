#!/usr/bin/env bash
# Publishes a VideoSOS release once all three builds are ready, as Bulka's make-release.sh does: the updater's
# latest.json for Windows, Linux and macOS, SHA256SUMS.txt over every file, and the GitHub release with them.
#   Windows - powershell scripts/build-release.ps1          -> release/<version>/
#   Linux   - bash scripts/build-linux-docker.sh <folder>   -> <folder> (VIDEOSOS_LINUX_DIR, default release/<version>-linux)
#   macOS   - the "macOS build" workflow on this commit; its artifact is downloaded here and its updater archive
#             signed with the key that lives only on this machine.
#   scripts/make-release.sh [--dry-run]
# Needs gh signed in to timoncool/videosos and ~/.tauri/videosos-updater.key with its .password beside it
# (VIDEOSOS_KEY_FILE overrides the path). --dry-run builds release/<version>-final and stops before the release.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
command -v cygpath >/dev/null && ROOT="$(cygpath -m "$ROOT")"
REPO="timoncool/videosos"
VER="$(node -pe "require('$ROOT/desktop/src-tauri/tauri.conf.json').version")"
TAG="v$VER"
WIN_DIR="$ROOT/release/$VER"
LINUX_DIR="${VIDEOSOS_LINUX_DIR:-$ROOT/release/$VER-linux}"
MAC_DIR="$ROOT/release/$VER-macos"
OUT="$ROOT/release/$VER-final"
KEY="${VIDEOSOS_KEY_FILE:-$HOME/.tauri/videosos-updater.key}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

SETUP="$(ls "$WIN_DIR"/*_"$VER"_x64-setup.exe 2>/dev/null | head -n 1 || true)"
MSI="$(ls "$WIN_DIR"/*_"$VER"_x64_*.msi 2>/dev/null | head -n 1 || true)"
PORTABLE="$WIN_DIR/VideoSOS-$VER-portable-windows-x64.zip"
APPIMAGE="$LINUX_DIR/VideoSOS-$VER-linux-x86_64.AppImage"
DEB="$LINUX_DIR/VideoSOS-$VER-linux-amd64.deb"
DMG="$MAC_DIR/VideoSOS-$VER-macos-arm64.dmg"
MAC_TGZ="$MAC_DIR/VideoSOS-$VER-macos-arm64.app.tar.gz"

missing=()
for f in "$SETUP" "$SETUP.sig" "$MSI" "$MSI.sig" "$PORTABLE" "$APPIMAGE" "$APPIMAGE.sig" "$DEB"; do
  [ -n "$f" ] && [ -f "$f" ] || missing+=("${f:-the Windows installer of $VER in $WIN_DIR}")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "[ERROR] build files are missing:"; printf '  %s\n' "${missing[@]}"; exit 1
fi
[ -f "$KEY" ] && [ -f "$KEY.password" ] || { echo "[ERROR] no updater key: $KEY and $KEY.password"; exit 1; }

echo "[..] macOS: the \"macOS build\" artifact of $(git -C "$ROOT" rev-parse --short HEAD)"
SHA="$(git -C "$ROOT" rev-parse HEAD)"
RUN="$(gh run list --repo "$REPO" --workflow release-unix.yml --status success --json databaseId,headSha \
  --jq "map(select(.headSha == \"$SHA\"))[0].databaseId // empty")"
[ -n "$RUN" ] || { echo "[ERROR] no successful \"macOS build\" of $SHA: gh workflow run release-unix.yml --repo $REPO --ref <branch>"; exit 1; }
rm -rf "$MAC_DIR"
gh run download "$RUN" --repo "$REPO" --name videosos-macos-arm64 --dir "$MAC_DIR"
[ -f "$DMG" ] && [ -f "$MAC_TGZ" ] || { echo "[ERROR] run $RUN has no $(basename "$DMG") or $(basename "$MAC_TGZ")"; exit 1; }
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$KEY.password")" \
  npm --prefix "$ROOT/desktop" exec tauri -- signer sign -f "$KEY" "$MAC_TGZ" >/dev/null
[ -f "$MAC_TGZ.sig" ] || { echo "[ERROR] $(basename "$MAC_TGZ") was not signed"; exit 1; }

rm -rf "$OUT" && mkdir -p "$OUT"
ASSETS=("$SETUP" "$SETUP.sig" "$MSI" "$MSI.sig" "$PORTABLE" "$APPIMAGE" "$APPIMAGE.sig" "$DEB" "$DMG" "$MAC_TGZ" "$MAC_TGZ.sig")
cp "${ASSETS[@]}" "$OUT/"
# GitHub serves a name with spaces with dots instead; the manifest names each file as it is served
url() { echo "https://github.com/$REPO/releases/download/$TAG/$(basename "$1" | tr ' ' '.')"; }
node -e '
const fs = require("fs");
const [out, ver, ...rest] = process.argv.slice(1);
const platforms = {};
for (let i = 0; i < rest.length; i += 3) {
  platforms[rest[i]] = { signature: fs.readFileSync(rest[i + 1], "utf8").trim(), url: rest[i + 2] };
}
const manifest = { version: ver, notes: `VideoSOS ${ver}`, pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"), platforms };
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
' "$OUT/latest.json" "$VER" \
  windows-x86_64 "$SETUP.sig" "$(url "$SETUP")" \
  windows-x86_64-nsis "$SETUP.sig" "$(url "$SETUP")" \
  windows-x86_64-msi "$MSI.sig" "$(url "$MSI")" \
  linux-x86_64 "$APPIMAGE.sig" "$(url "$APPIMAGE")" \
  linux-x86_64-appimage "$APPIMAGE.sig" "$(url "$APPIMAGE")" \
  darwin-aarch64 "$MAC_TGZ.sig" "$(url "$MAC_TGZ")" \
  darwin-aarch64-app "$MAC_TGZ.sig" "$(url "$MAC_TGZ")"
(cd "$OUT" && sha256sum -- * | sed 's/ \*/  /' > SHA256SUMS.txt)
echo "[OK] $OUT: latest.json, SHA256SUMS.txt and $(ls "$OUT" | wc -l) files"
[ "$DRY" = 1 ] && { echo "[OK] dry run: no release made"; exit 0; }

NOTES="$(awk -v ver="$VER" '$0 ~ "^## .* — " ver "$" {take=1; next} /^## / {take=0} take' "$ROOT/CHANGELOG.md")"
[ -n "$NOTES" ] || { echo "[ERROR] CHANGELOG.md has no section for $VER"; exit 1; }
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$OUT"/* --repo "$REPO" --clobber
else
  gh release create "$TAG" "$OUT"/* --repo "$REPO" --title "VideoSOS $VER" --notes "$NOTES"
fi
echo "[OK] https://github.com/$REPO/releases/tag/$TAG"
