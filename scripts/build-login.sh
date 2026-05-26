#!/bin/bash
# Build the native Swift login app into a .app bundle.
#
# Output: bin/ClaudeUsageLogin.app  (ad-hoc signed, unsandboxed)
#
# Requires: swift toolchain (comes with Xcode CLT or full Xcode).
# Idempotent — safe to re-run; will rebuild only if source has changed.

set -euo pipefail

GREEN='\033[0;32m'; AMBER='\033[0;33m'; DIM='\033[2m'; RESET='\033[0m'
step()  { echo -e "${GREEN}▶${RESET} $1"; }
warn()  { echo -e "${AMBER}!${RESET} $1"; }
hint()  { echo -e "${DIM}  $1${RESET}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

if ! command -v swift >/dev/null 2>&1; then
  warn "swift not found — skipping native login app build."
  hint "Install Xcode CLT (xcode-select --install) and re-run to enable one-click login."
  exit 0
fi

APP_NAME="ClaudeUsageLogin"
BUNDLE_ID="dev.claude-usage-plugin.login"
APP_PATH="$REPO_DIR/bin/${APP_NAME}.app"
SPM_DIR="$REPO_DIR/swift-login"

step "Building Swift package (release)…"
( cd "$SPM_DIR" && swift build -c release ) | tail -3

EXE="$SPM_DIR/.build/release/$APP_NAME"
[ -x "$EXE" ] || { echo "build failed — $EXE missing"; exit 1; }

step "Assembling .app bundle…"
rm -rf "$APP_PATH"
mkdir -p "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources"
cp "$EXE" "$APP_PATH/Contents/MacOS/$APP_NAME"

cat > "$APP_PATH/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>             <string>$APP_NAME</string>
  <key>CFBundleDisplayName</key>      <string>Claude Sign-in</string>
  <key>CFBundleExecutable</key>       <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>       <string>$BUNDLE_ID</string>
  <key>CFBundlePackageType</key>      <string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key>          <string>1</string>
  <key>LSMinimumSystemVersion</key>   <string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key>  <true/>
  <key>NSPrincipalClass</key>         <string>NSApplication</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict>
</plist>
EOF
plutil -lint "$APP_PATH/Contents/Info.plist" >/dev/null

step "Ad-hoc signing…"
# Ad-hoc (no identity) signing — enough for local "Open Anyway" execution.
codesign --force --deep --sign - "$APP_PATH" >/dev/null 2>&1 || \
  warn "codesign failed; app will still run after the user clicks 'Open Anyway' once"

# Remove macOS quarantine attribute so Gatekeeper doesn't prompt every time.
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true

hint "$APP_PATH"
hint "size: $(du -sh "$APP_PATH" | cut -f1)"
