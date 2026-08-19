#!/usr/bin/env sh
# Build Ace Sign Studio. Default target: Windows x64 exe → ../dist/
# The version below is the single source of truth: it is stamped into the
# binary and written to dist/version.json (with the exe's SHA-256) so the
# in-app updater can detect and verify new builds.
set -e
cd "$(dirname "$0")"

VERSION="3.10.0"
# One-line summary shown in the in-app update banner for older versions.
NOTES="New STIHL Clearance sign: a loud clearance banner, optional was/now pricing, and the shop-inspected clearance policy in fine print."
# Updates are served from the stable GitHub Release (CI uploads the exe +
# this manifest there on every green build) — the exe is not in git.
DL_BASE="https://github.com/codysuter/codysuter/releases/download/ace-sign-studio-windows"
LDFLAGS="-s -w -X main.appVersion=$VERSION"
# Release builds embed the store's sync token (base64) from the
# ACE_SYNC_TOKEN repo secret — CI sets it; local builds go without and
# sync then needs a token pasted in Settings.
if [ -n "$ACE_SYNC_TOKEN" ]; then
  LDFLAGS="$LDFLAGS -X main.embeddedSyncTokenB64=$(printf %s "$ACE_SYNC_TOKEN" | base64 | tr -d '\n')"
fi
mkdir -p ../dist

# JSON string escaping for the manifest fields. Without it, one straight
# quote (or backslash) in NOTES ships a syntactically invalid version.json
# and every installed copy's self-update check fails until the next release.
json_str() { printf %s "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

emit_manifest() {
  exe_path="$1"; exe_name="$2"
  sha=$(sha256sum "$exe_path" | cut -d' ' -f1)
  cat > ../dist/version.json <<JSON
{
  "version": "$(json_str "$VERSION")",
  "url": "$(json_str "$DL_BASE/$exe_name")",
  "sha256": "$sha",
  "notes": "$(json_str "$NOTES")"
}
JSON
  echo "wrote ../dist/version.json ($VERSION, sha256 $sha)"
}

case "${1:-windows}" in
  windows)
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
      go build -ldflags="$LDFLAGS -H windowsgui" -o ../dist/AceSignStudio.exe .
    echo "built ../dist/AceSignStudio.exe ($VERSION)"
    emit_manifest ../dist/AceSignStudio.exe AceSignStudio.exe
    ;;
  mac)
    GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 \
      go build -ldflags="$LDFLAGS" -o ../dist/AceSignStudio-mac-arm64 .
    echo "built ../dist/AceSignStudio-mac-arm64 ($VERSION)"
    ;;
  linux)
    CGO_ENABLED=0 go build -ldflags="$LDFLAGS" -o ../dist/AceSignStudio-linux .
    echo "built ../dist/AceSignStudio-linux ($VERSION)"
    ;;
  *)
    echo "usage: build.sh [windows|mac|linux]" >&2
    exit 1
    ;;
esac
