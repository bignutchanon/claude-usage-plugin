// macOS Keychain wrapper for storing the claude.ai credentials.
//
// Why Keychain instead of .env:
//   - The .env file lives next to the source tree; one bad `cat .env > /tmp/x`
//     in a script and the cookie leaks.
//   - Keychain entries are scoped to the user account and ACL-protected.
//   - `security` is a built-in macOS tool, no extra deps.
//
// Item layout (`security find-generic-password -s claude-usage-monitor -a <key>`):
//   service = "claude-usage-monitor"
//   account = one of: "sessionKey", "orgId", "clientSha", "deviceId",
//                     "anonymousId", "clientVersion"
//
// Reading via env vars is still supported and overrides Keychain — useful for
// CI / smoke tests / one-off debugging.

const { spawnSync } = require('child_process');

const SERVICE = 'claude-usage-monitor';

// All recognised credential keys, ordered by importance. The setup wizard
// asks for sessionKey + orgId (required); the rest are optional fingerprint
// headers that claude.ai sometimes wants.
const KEYS = [
  'sessionKey',
  'orgId',
  'clientSha',
  'deviceId',
  'anonymousId',
  'clientVersion',
];

// Map our internal key → the .env variable name (back-compat).
const ENV_MAP = {
  sessionKey: 'CLAUDE_AI_SESSION_KEY',
  orgId: 'CLAUDE_AI_ORG_ID',
  clientSha: 'CLAUDE_AI_CLIENT_SHA',
  deviceId: 'CLAUDE_AI_DEVICE_ID',
  anonymousId: 'CLAUDE_AI_ANONYMOUS_ID',
  clientVersion: 'CLAUDE_AI_CLIENT_VERSION',
};

function isMac() {
  return process.platform === 'darwin';
}

// Read one secret. Prefer env var if set, else fall back to Keychain.
function get(key) {
  const envName = ENV_MAP[key];
  if (envName && process.env[envName]) return process.env[envName];

  if (!isMac()) return '';

  const r = spawnSync(
    'security',
    ['find-generic-password', '-s', SERVICE, '-a', key, '-w'],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return '';
  return (r.stdout || '').trim();
}

// Write one secret. `-U` updates if it exists.
function set(key, value) {
  if (!isMac()) throw new Error('Keychain storage requires macOS');
  if (!KEYS.includes(key)) throw new Error(`unknown credential key: ${key}`);

  const r = spawnSync(
    'security',
    [
      'add-generic-password',
      '-U',                       // update if exists
      '-s', SERVICE,
      '-a', key,
      '-w', value || '',
      '-T', '',                   // no app trusted to access without prompt
      '-D', 'application password',
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`security add-generic-password failed: ${r.stderr || r.stdout}`);
  }
}

// Remove one secret (used by uninstall / "forget credentials" UX).
function remove(key) {
  if (!isMac()) return;
  spawnSync('security', ['delete-generic-password', '-s', SERVICE, '-a', key], {
    encoding: 'utf8',
  });
}

// Return the same shape as the current claude-ai.js `config()` helper expects.
function readAll() {
  const out = {};
  for (const k of KEYS) out[k] = get(k);
  return out;
}

// "Configured" = we at least have the two required secrets.
function isConfigured() {
  return Boolean(get('sessionKey') && get('orgId'));
}

// Was a particular secret sourced from env (vs Keychain)? Used by the wizard
// to warn the user that env-set values will shadow whatever they save.
function sourceOf(key) {
  const envName = ENV_MAP[key];
  if (envName && process.env[envName]) return 'env';
  return get(key) ? 'keychain' : 'missing';
}

module.exports = {
  SERVICE, KEYS,
  get, set, remove, readAll,
  isConfigured, sourceOf,
};
