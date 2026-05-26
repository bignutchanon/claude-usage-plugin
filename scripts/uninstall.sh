#!/bin/bash
# Reverse of install.sh — stops the service, removes the launchd plist,
# clears Keychain credentials. Leaves the repo + node_modules + .env alone.

set -euo pipefail

LABEL="dev.claude-usage-plugin"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

echo "claude-usage-plugin uninstaller"
echo "──────────────────────────────"

# Service teardown.
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "▶ stopping LaunchAgent"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
fi
if [ -f "$PLIST_PATH" ]; then
  echo "▶ removing $PLIST_PATH"
  rm -f "$PLIST_PATH"
fi

# Keychain teardown.
SERVICE="claude-usage-monitor"
for key in sessionKey orgId clientSha deviceId anonymousId clientVersion; do
  security delete-generic-password -s "$SERVICE" -a "$key" >/dev/null 2>&1 && \
    echo "▶ forgot Keychain entry: $key" || true
done

# Native sign-in app + Swift build artifacts (v3).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -d "$REPO_DIR/bin/ClaudeUsageLogin.app" ]; then
  echo "▶ removing $REPO_DIR/bin/ClaudeUsageLogin.app"
  rm -rf "$REPO_DIR/bin/ClaudeUsageLogin.app"
fi
if [ -d "$REPO_DIR/swift-login/.build" ]; then
  echo "▶ removing Swift build cache"
  rm -rf "$REPO_DIR/swift-login/.build"
fi

echo
echo "✓ uninstall complete."
echo "  the repo and node_modules are untouched — delete the folder manually if you want."
