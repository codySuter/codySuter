#!/bin/sh
# Build the Windows executable (and a Linux binary for local testing).
# Run from anywhere; outputs land in sign-shop/dist/.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCHER="$ROOT/launcher"
DIST="$ROOT/dist"
GO="${GO:-/usr/local/go/bin/go}"

# Stage the app files the exe embeds (everything the browser needs).
rm -rf "$LAUNCHER/app"
mkdir -p "$LAUNCHER/app/data" "$LAUNCHER/app/fonts" "$DIST"
cp "$ROOT/index.html" "$ROOT/styles.css" "$ROOT/app.js" "$ROOT/fonts.css" "$LAUNCHER/app/"
[ -f "$ROOT/poster.html" ] && cp "$ROOT/poster.html" "$LAUNCHER/app/"
[ -f "$ROOT/poster-legacy.html" ] && cp "$ROOT/poster-legacy.html" "$LAUNCHER/app/"
cp "$ROOT"/data/*.js "$LAUNCHER/app/data/"
cp "$ROOT"/fonts/*.woff2 "$LAUNCHER/app/fonts/"

cd "$LAUNCHER"
[ -f go.mod ] || "$GO" mod init signshop

# Windows: -H windowsgui keeps a console window from flashing open.
GOOS=windows GOARCH=amd64 "$GO" build -ldflags "-s -w -H windowsgui" -o "$DIST/SignShop.exe" .
# Linux build only for testing the launcher logic in CI/sandboxes.
GOOS=linux GOARCH=amd64 "$GO" build -ldflags "-s -w" -o "$DIST/signshop-linux" .

ls -la "$DIST"
