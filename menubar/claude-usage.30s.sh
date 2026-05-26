#!/bin/bash
# SwiftBar / xbar wrapper — refreshes every 30 seconds (encoded in the filename).
# Locates a working `node` (nvm or system) and runs the plugin.

# <bitbar.title>Claude Usage</bitbar.title>
# <bitbar.version>1.0</bitbar.version>
# <bitbar.author>chanonsangpat</bitbar.author>
# <bitbar.desc>Realtime Claude Max plan usage from claude.ai and local logs.</bitbar.desc>
# <swiftbar.hideAbout>false</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideDisablePlugin>false</swiftbar.hideDisablePlugin>

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JS_FILE="$SCRIPT_DIR/claude-usage.js"

# Try nvm first (most common for this user), then system node.
if [ -z "${NODE_BIN:-}" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
  fi
  NODE_BIN="$(command -v node || true)"
fi

# Fallback: scan common install locations.
if [ -z "$NODE_BIN" ]; then
  for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$HOME/.nvm/versions/node"/*/bin/node ; do
    [ -x "$candidate" ] && NODE_BIN="$candidate" && break
  done
fi

if [ -z "$NODE_BIN" ]; then
  printf 'CLAUDE · NO NODE | color=#e8341c\n---\nnode executable not found on PATH\nInstall Node.js or set NODE_BIN in this script\n'
  exit 0
fi

exec "$NODE_BIN" "$JS_FILE"
