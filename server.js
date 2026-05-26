require('dotenv').config();
const path = require('path');
const express = require('express');
const chokidar = require('chokidar');
const { aggregate, PROJECTS_DIR } = require('./lib/parser');
const { fetchMessagesUsage } = require('./lib/api-usage');
const claudeAi = require('./lib/claude-ai');

const PORT = Number(process.env.PORT || 4000);
const app = express();

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

app.listen(PORT, () => {
  console.log(`Claude Usage Monitor → http://localhost:${PORT}`);
  console.log(`Watching: ${PROJECTS_DIR}`);
  refreshLimits().catch((e) => console.error('initial limits fetch failed', e));
  rebuild().catch((e) => console.error('initial build failed', e));
});
