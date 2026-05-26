#!/bin/bash
# claude-usage-plugin installer.
#
# - Detects a working Node binary
# - Renders launchd plist from template with this user's paths
# - Bootstraps the LaunchAgent so the server starts on every login
# - (Optional) configures SwiftBar plugin folder
# - Prints next steps for completing setup via the web wizard
#
# Idempotent. Safe to re-run.

set -euo pipefail

# ── colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
AMBER='\033[0;33m'
RED='\033[0;31m'
DIM='\033[2m'
RESET='\033[0m'

step()  { echo -e "${GREEN}▶${RESET} $1"; }
warn()  { echo -e "${AMBER}!${RESET} $1"; }
fail()  { echo -e "${RED}✗${RESET} $1" >&2; exit 1; }
hint()  { echo -e "${DIM}  $1${RESET}"; }

# ── locate the repo ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

LABEL="dev.claude-usage-plugin"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs"
LOG_PATH="$LOG_DIR/claude-usage-plugin.log"
LOG_ERR_PATH="$LOG_DIR/claude-usage-plugin.error.log"

echo
echo "claude-usage-plugin installer"
echo "─────────────────────────────"
echo "repo: $REPO_DIR"
echo "label: $LABEL"
echo

# ── platform check ───────────────────────────────────────────────────────────
[ "$(uname)" = "Darwin" ] || fail "This installer is macOS-only (launchd + Keychain)."

# ── detect node ──────────────────────────────────────────────────────────────
step "Detecting Node…"
NODE_BIN=""
if [ -n "${NVM_DIR:-}" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
fi
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.nvm/versions/node"/*/bin/node; do
    [ -x "$candidate" ] && NODE_BIN="$candidate" && break
  done
fi
[ -z "$NODE_BIN" ] && fail "node not found. Install with: brew install node"

NODE_VERSION="$("$NODE_BIN" --version)"
echo "  node: $NODE_BIN ($NODE_VERSION)"
NODE_DIR="$(dirname "$NODE_BIN")"

# ── install deps ─────────────────────────────────────────────────────────────
step "Installing dependencies…"
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  npm install --silent
fi
hint "ok"

# ── render plist ─────────────────────────────────────────────────────────────
step "Rendering launchd plist…"
mkdir -p "$LOG_DIR" "$(dirname "$PLIST_PATH")"
sed \
  -e "s|{{LABEL}}|$LABEL|g" \
  -e "s|{{NODE_BIN}}|$NODE_BIN|g" \
  -e "s|{{WORKDIR}}|$REPO_DIR|g" \
  -e "s|{{PATH}}|$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin|g" \
  -e "s|{{LOG}}|$LOG_PATH|g" \
  -e "s|{{LOG_ERR}}|$LOG_ERR_PATH|g" \
  scripts/launchd.plist.template > "$PLIST_PATH"

plutil -lint "$PLIST_PATH" >/dev/null || fail "generated plist failed plutil lint"
hint "$PLIST_PATH"

# ── build the native sign-in app (v3) — optional, falls back to manual paste
step "Building one-click sign-in app (optional)…"
"$REPO_DIR/scripts/build-login.sh" || warn "skipping native sign-in build; manual paste flow still works"

# ── (re)load the LaunchAgent ─────────────────────────────────────────────────
step "Bootstrapping LaunchAgent…"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
sleep 2

# ── wait for the server to come up ───────────────────────────────────────────
PORT="${PORT:-4000}"
TRIES=20
while [ $TRIES -gt 0 ]; do
  if curl -sf "http://127.0.0.1:$PORT/api/setup/status" >/dev/null 2>&1; then
    hint "server is live at http://127.0.0.1:$PORT"
    break
  fi
  sleep 0.5
  TRIES=$((TRIES - 1))
done
[ $TRIES -eq 0 ] && warn "server didn't respond within 10s; check $LOG_ERR_PATH"

# ── SwiftBar (optional) ──────────────────────────────────────────────────────
echo
if [ -d "/Applications/SwiftBar.app" ]; then
  step "Configuring SwiftBar plugin folder…"
  defaults write com.ameba.SwiftBar PluginDirectory -string "$REPO_DIR/menubar"
  hint "plugin folder → $REPO_DIR/menubar"
  hint "open SwiftBar → Preferences → re-pick the folder to grant macOS permission"
  open -a SwiftBar 2>/dev/null || true
else
  warn "SwiftBar not installed. Install with:  brew install --cask swiftbar"
fi

# ── finish ───────────────────────────────────────────────────────────────────
echo
echo -e "${GREEN}✓${RESET} install complete."
echo
echo "Next: open the dashboard and finish the setup wizard."
echo
echo "    open http://127.0.0.1:$PORT"
echo
echo "Useful commands:"
echo "    tail -f $LOG_PATH                                                  # logs"
echo "    launchctl kickstart -k gui/\$(id -u)/$LABEL                          # restart"
echo "    launchctl bootout    gui/\$(id -u)/$LABEL && rm $PLIST_PATH         # uninstall"
echo
