#!/usr/bin/env sh
# Build Ace Sign Studio. Default target: Windows x64 exe → ../dist/
set -e
cd "$(dirname "$0")"
mkdir -p ../dist
case "${1:-windows}" in
  windows)
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
      go build -ldflags="-s -w -H windowsgui" -o ../dist/AceSignStudio.exe .
    echo "built ../dist/AceSignStudio.exe"
    ;;
  mac)
    GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 \
      go build -ldflags="-s -w" -o ../dist/AceSignStudio-mac-arm64 .
    echo "built ../dist/AceSignStudio-mac-arm64"
    ;;
  linux)
    CGO_ENABLED=0 go build -ldflags="-s -w" -o ../dist/AceSignStudio-linux .
    echo "built ../dist/AceSignStudio-linux"
    ;;
  *)
    echo "usage: build.sh [windows|mac|linux]" >&2
    exit 1
    ;;
esac
