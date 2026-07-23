#!/usr/bin/env sh
# Build Ace Sign Studio. Default target: Windows x64 exe → ../dist/
# The version below is the single source of truth: it is stamped into the
# binary and written to dist/version.json (with the exe's SHA-256) so the
# in-app updater can detect and verify new builds.
set -e
cd "$(dirname "$0")"

VERSION="2.2.0"
DL_BASE="https://github.com/codysuter/codysuter/raw/main/dist"
LDFLAGS="-s -w -X main.appVersion=$VERSION"
mkdir -p ../dist

emit_manifest() {
  exe_path="$1"; exe_name="$2"
  sha=$(sha256sum "$exe_path" | cut -d' ' -f1)
  cat > ../dist/version.json <<JSON
{
  "version": "$VERSION",
  "url": "$DL_BASE/$exe_name",
  "sha256": "$sha",
  "notes": "Latest Ace Sign Studio build."
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
