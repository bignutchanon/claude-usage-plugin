require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const chokidar = require('chokidar');
const { aggregate, PROJECTS_DIR } = require('./lib/parser');
const { fetchMessagesUsage } = require('./lib/api-usage');
const claudeAi = require('./lib/claude-ai');
const keychain = require('./lib/keychain');

const LOGIN_APP_PATH = path.join(__dirname, 'bin', 'ClaudeUsageLogin.app');
const loginAppAvailable = fs.existsSync(LOGIN_APP_PATH);

const PORT = Number(process.env.PORT || 4000);
const app = express();

// JSON body parser for /api/setup/save (small payloads only — sessionKey is
// long but well under 1 KB).
app.use(express.json({ limit: '32kb' }));

// Redirect dashboard root to /setup until credentials exist. Saves users
// from seeing an empty broken dashboard on first launch.
app.use((req, res, next) => {
  const path = req.path;
  const isSetupRoute =
    path === '/setup' ||
    path === '/setup/' ||
    path.startsWith('/setup/') ||
    path.startsWith('/api/setup') ||
    path.startsWith('/vendor/') ||
    path === '/styles.css' ||
    path === '/favicon.ico';
  if (!keychain.isConfigured() && path === '/' && !isSetupRoute) {
    return res.redirect(302, '/setup');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

let cache = null;
let cacheBuiltAt = 0;
let rebuilding = null;
const CACHE_TTL_MS = 5_000;

let limitsCache = null;
let limitsCheckedAt = 0;
const LIMITS_POLL_MS = 30_000;

async function rebuild() {
  const data = await aggregate();
  if (limitsCache) data.planLimits = limitsCache;
  cache = data;
  cacheBuiltAt = Date.now();
  broadcast('usage', cache);
  // Parsing 192 JSONL files churns through tens of MB of intermediate objects.
  // V8 grows the heap to fit the peak but doesn't shrink it back on its own,
  // so RSS climbs over time. With --expose-gc we can reclaim immediately.
  if (typeof global.gc === 'function') global.gc();
  return cache;
}

async function refreshLimits() {
  try {
    const result = await claudeAi.fetchUsage();
    if (result.configured && result.data) {
      limitsCache = {
        source: 'claude.ai',
        fetchedAt: Date.now(),
        ...result.data,
      };
      if (cache) {
        cache.planLimits = limitsCache;
        broadcast('limits', limitsCache);
      }
    } else if (result.error) {
      limitsCache = { source: 'claude.ai', error: result.error, fetchedAt: Date.now() };
      if (cache) cache.planLimits = limitsCache;
      broadcast('limits', limitsCache);
    }
  } catch (err) {
    console.error('refreshLimits failed', err);
  }
  limitsCheckedAt = Date.now();
}

async function getUsage() {
  if (cache && Date.now() - cacheBuiltAt < CACHE_TTL_MS) return cache;
  if (!rebuilding) {
    rebuilding = rebuild().finally(() => {
      rebuilding = null;
    });
  }
  return rebuilding;
}

app.get('/api/usage/local', async (_req, res) => {
  try {
    const data = await getUsage();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/usage/claude-ai', async (_req, res) => {
  try {
    const [usage, org, rateLimits] = await Promise.all([
      claudeAi.fetchUsage(),
      claudeAi.fetchOrg(),
      claudeAi.fetchRateLimits(),
    ]);
    res.json({ usage, org, rateLimits });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/limits', async (_req, res) => {
  if (!limitsCache || Date.now() - limitsCheckedAt > LIMITS_POLL_MS) {
    await refreshLimits();
  }
  res.json(limitsCache || { source: 'claude.ai', configured: false });
});

app.get('/api/usage/api', async (req, res) => {
  try {
    const result = await fetchMessagesUsage({
      startDate: req.query.start,
      endDate: req.query.end,
      bucketWidth: req.query.bucket || '1d',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── SETUP WIZARD ───────────────────────────────────────────────────────────
// Status: shape that lets the wizard render correct state. NEVER returns the
// sessionKey value itself — only "is it set, and where did it come from?".
app.get('/api/setup/status', (_req, res) => {
  const status = {};
  for (const k of keychain.KEYS) status[k] = keychain.sourceOf(k);
  res.json({
    configured: keychain.isConfigured(),
    items: status,
    platform: process.platform,
    loginAppAvailable,
  });
});

// Validate + save. Body shape:
//   { sessionKey, orgId, clientSha?, deviceId?, anonymousId?, clientVersion? }
// First we call claude.ai with the proposed cookie. If it returns the org
// successfully, we persist to Keychain. Otherwise we return a structured error
// without writing anything.
app.post('/api/setup/save', async (req, res) => {
  const body = req.body || {};
  const sessionKey = String(body.sessionKey || '').trim();
  const orgId = String(body.orgId || '').trim();
  if (!sessionKey || !orgId) {
    return res.status(400).json({ error: 'sessionKey and orgId are required' });
  }
  // Defensive shape check on sessionKey — must look like an Anthropic cookie.
  if (!/^sk-ant-sid\d{2}-/.test(sessionKey)) {
    return res.status(400).json({
      error: 'sessionKey doesn\'t look right — it should start with "sk-ant-sid01-" (copy from claude.ai cookies, full value)',
    });
  }
  if (!/^[0-9a-f-]{20,}$/i.test(orgId)) {
    return res.status(400).json({ error: 'orgId should be a UUID' });
  }

  const headers = {
    clientSha: String(body.clientSha || '').trim(),
    deviceId: String(body.deviceId || '').trim(),
    anonymousId: String(body.anonymousId || '').trim(),
  };

  const check = await claudeAi.validateCredentials({ sessionKey, orgId, headers });
  if (!check.ok) {
    return res.status(401).json({ error: check.error });
  }

  // Validation succeeded — persist.
  try {
    keychain.set('sessionKey', sessionKey);
    keychain.set('orgId', orgId);
    if (headers.clientSha) keychain.set('clientSha', headers.clientSha);
    if (headers.deviceId) keychain.set('deviceId', headers.deviceId);
    if (headers.anonymousId) keychain.set('anonymousId', headers.anonymousId);
    if (body.clientVersion) keychain.set('clientVersion', String(body.clientVersion).trim());
  } catch (err) {
    return res.status(500).json({ error: `failed to write Keychain: ${err.message}` });
  }

  // Kick off a refresh so the dashboard has data the moment the user lands.
  refreshLimits().catch(() => {});

  res.json({ ok: true, org: check.org });
});

// Forget all credentials (uninstall / "switch account").
app.post('/api/setup/forget', (_req, res) => {
  for (const k of keychain.KEYS) keychain.remove(k);
  limitsCache = null;
  res.json({ ok: true });
});

// Launch the native sign-in app (v3). Returns whether it was launched,
// so the wizard can fall back to the manual paste flow if the .app isn't
// built (Swift toolchain absent at install time).
app.post('/api/setup/launch-login', (_req, res) => {
  if (!loginAppAvailable) {
    return res.status(404).json({
      ok: false,
      error: 'ClaudeUsageLogin.app is not built — run ./scripts/build-login.sh',
    });
  }
  try {
    // `open` returns immediately; the .app POSTs to /api/setup/save when done.
    spawn('open', [LOGIN_APP_PATH], { detached: true, stdio: 'ignore' }).unref();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// SSE channel
const clients = new Set();
app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    try {
      c.write(data);
    } catch {
      clients.delete(c);
    }
  }
}

// Watch ~/.claude/projects for changes and debounce a rebuild.
let debounceTimer = null;
function scheduleRebuild() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    rebuild().catch((e) => console.error('rebuild failed', e));
  }, 750);
}

const watcher = chokidar.watch(`${PROJECTS_DIR}/**/*.jsonl`, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
});
watcher.on('add', scheduleRebuild);
watcher.on('change', scheduleRebuild);
watcher.on('unlink', scheduleRebuild);

// Heartbeat so clients can detect disconnects
setInterval(() => broadcast('ping', { t: Date.now() }), 15_000);

// Poll claude.ai/usage for real plan limit data
setInterval(refreshLimits, LIMITS_POLL_MS);

// Bind to 127.0.0.1 ONLY so nobody on the local network can read the
// usage payload (which is sensitive — token counts, costs, session metadata).
// Override with HOST=0.0.0.0 only if you know what you're doing.
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`Claude Usage Monitor → http://${HOST}:${PORT}`);
  console.log(`Watching: ${PROJECTS_DIR}`);
  refreshLimits().catch((e) => console.error('initial limits fetch failed', e));
  rebuild().catch((e) => console.error('initial build failed', e));
});
