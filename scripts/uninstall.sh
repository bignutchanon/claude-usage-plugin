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

echo
echo "✓ uninstall complete."
echo "  the repo and node_modules are untouched — delete the folder manually if you want."
