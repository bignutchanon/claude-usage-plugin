#!/bin/bash
# SwiftBar streamable wrapper — does NOT exit; emits new menu frames on every
# /api/stream SSE event (instant parity with the dashboard).
#
# Streamable mode is signalled by ".stream" in the filename. The numeric refresh
# interval is ignored when .stream is present.

# <bitbar.title>Claude Usage (Stream)</bitbar.title>
# <bitbar.version>2.0</bitbar.version>
# <bitbar.author>bignutchanon</bitbar.author>
# <bitbar.desc>Realtime Claude Max plan usage via SSE from a local dashboard.</bitbar.desc>
# <swiftbar.hideAbout>false</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideDisablePlugin>false</swiftbar.hideDisablePlugin>
# <swiftbar.useTrailingStreamSeparator>true</swiftbar.useTrailingStreamSeparator>

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JS_FILE="$SCRIPT_DIR/claude-usage.stream.js"

if [ -z "${NODE_BIN:-}" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
  fi
  NODE_BIN="$(command -v node || true)"
fi

if [ -z "$NODE_BIN" ]; then
  for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$HOME/.nvm/versions/node"/*/bin/node ; do
    [ -x "$candidate" ] && NODE_BIN="$candidate" && break
  done
fi

if [ -z "$NODE_BIN" ]; then
  printf 'CLAUDE · NO NODE | color=#ff003c\n---\nnode executable not found on PATH\n~~~\n'
  # Block forever so SwiftBar doesn't tight-loop respawning us.
  while true; do sleep 3600; done
fi

exec "$NODE_BIN" "$JS_FILE"
