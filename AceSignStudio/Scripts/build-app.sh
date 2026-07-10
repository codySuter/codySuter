#!/bin/bash
# Builds Ace Sign Studio into a double-clickable macOS app bundle.
# Usage:  ./Scripts/build-app.sh
# Result: "Ace Sign Studio.app" in the AceSignStudio folder — drag it into /Applications.
set -euo pipefail

cd "$(dirname "$0")/.."

APP_NAME="Ace Sign Studio"
EXECUTABLE="AceSignStudio"
BUNDLE_ID="com.snyders.ace-sign-studio"
VERSION="1.0"

echo "▸ Building release binary (first build can take a few minutes)…"
swift build -c release

APP="$APP_NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp ".build/release/$EXECUTABLE" "$APP/Contents/MacOS/$EXECUTABLE"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>$APP_NAME</string>
    <key>CFBundleDisplayName</key><string>$APP_NAME</string>
    <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
    <key>CFBundleExecutable</key><string>$EXECUTABLE</string>
    <key>CFBundleVersion</key><string>$VERSION</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>NSHumanReadableCopyright</key><string>Snyder's Ace Hardware</string>
</dict>
</plist>
PLIST

echo "▸ Generating app icon…"
ICONSET="$(mktemp -d)/AppIcon.iconset"
if swift Scripts/generate-icon.swift "$ICONSET" >/dev/null 2>&1 \
   && iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns" >/dev/null 2>&1; then
    echo "  icon OK"
else
    echo "  (icon step skipped — the app still works, it just uses a generic icon)"
fi

echo "▸ Signing (ad-hoc, for local use)…"
codesign --force --deep -s - "$APP" 2>/dev/null || true

echo ""
echo "✅ Done: $(pwd)/$APP"
echo "   Drag it into /Applications and double-click to use."
