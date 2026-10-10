#!/usr/bin/env sh
# Build Ace Location Studio. Default target: Windows x64 exe → ../dist/ace-location-studio/
# The version below is the single source of truth: it is stamped into the
# binary and written to dist/version.json (with the exe's SHA-256) so the
# in-app updater can detect and verify new builds.
set -e
cd "$(dirname "$0")"

VERSION="1.2.1"
# One-line summary shown in the in-app update banner for older versions.
NOTES="Compass: works with Epicor-hosted Eagle servers and older Compass versions, and the connection test now shows the real reason a login fails."
# Updates are served from the stable GitHub Release (CI uploads the exe +
# this manifest there on every green build) — the exe is not in git.
DL_BASE="https://github.com/codysuter/codysuter/releases/download/ace-location-studio-windows"
LDFLAGS="-s -w -X main.appVersion=$VERSION"
OUT=../dist/ace-location-studio
mkdir -p "$OUT"

# JSON string escaping for the manifest fields. Without it, one straight
# quote (or backslash) in NOTES ships a syntactically invalid version.json
# and every installed copy's self-update check fails until the next release.
json_str() { printf %s "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

emit_manifest() {
  exe_path="$1"; exe_name="$2"
  sha=$(sha256sum "$exe_path" | cut -d' ' -f1)
  cat > $OUT/version.json <<JSON
{
  "version": "$(json_str "$VERSION")",
  "url": "$(json_str "$DL_BASE/$exe_name")",
  "sha256": "$sha",
  "notes": "$(json_str "$NOTES")"
}
JSON
  echo "wrote $OUT/version.json ($VERSION, sha256 $sha)"
}

case "${1:-windows}" in
  windows)
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
      go build -ldflags="$LDFLAGS -H windowsgui" -o $OUT/AceLocationStudio.exe .
    echo "built $OUT/AceLocationStudio.exe ($VERSION)"
    emit_manifest $OUT/AceLocationStudio.exe AceLocationStudio.exe
    ;;
  mac)
    GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 \
      go build -ldflags="$LDFLAGS" -o $OUT/AceLocationStudio-mac-arm64 .
    echo "built $OUT/AceLocationStudio-mac-arm64 ($VERSION)"
    ;;
  linux)
    CGO_ENABLED=0 go build -ldflags="$LDFLAGS" -o $OUT/AceLocationStudio-linux .
    echo "built $OUT/AceLocationStudio-linux ($VERSION)"
    ;;
  *)
    echo "usage: build.sh [windows|mac|linux]" >&2
    exit 1
    ;;
esac
