const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');
const { costForUsage, normalizeModel } = require('./pricing');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Decode the folder name back to a readable cwd: leading '-' + dashes → '/'
function decodeProjectPath(folderName) {
  if (!folderName) return '';
  const trimmed = folderName.startsWith('-') ? folderName.slice(1) : folderName;
  return '/' + trimmed.replace(/-/g, '/');
}

function emptyTotals() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    cost: 0,
    requests: 0,
  };
}

function addUsage(target, usage, model) {
  target.inputTokens += usage.input_tokens || 0;
  target.outputTokens += usage.output_tokens || 0;
  target.cacheReadTokens += usage.cache_read_input_tokens || 0;
  target.cacheCreateTokens += usage.cache_creation_input_tokens || 0;
  target.cost += costForUsage(model, usage);
  target.requests += 1;
}

// Stream a single JSONL file and yield assistant-message events with usage.
async function* readEvents(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== 'assistant' || !obj.message?.usage) continue;
    yield {
      timestamp: obj.timestamp,
      sessionId: obj.sessionId,
      cwd: obj.cwd,
      gitBranch: obj.gitBranch,
      version: obj.version,
      entrypoint: obj.entrypoint,
      model: obj.message.model,
      requestId: obj.requestId,
      usage: obj.message.usage,
    };
  }
}

async function listSessionFiles() {
  let entries;
  try {
    entries = await fs.promises.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(PROJECTS_DIR, entry.name);
    let inner;
    try {
      inner = await fs.promises.readdir(dir);
    } catch {
      continue;
    }
    for (const f of inner) {
      if (f.endsWith('.jsonl')) {
        files.push({
          path: path.join(dir, f),
          project: entry.name,
          projectPath: decodeProjectPath(entry.name),
          sessionId: f.replace(/\.jsonl$/, ''),
        });
      }
    }
  }
  return files;
}

async function aggregate({ sinceMs = null } = {}) {
  const files = await listSessionFiles();
  const totals = emptyTotals();
  const byModel = new Map();
  const byProject = new Map();
  const byDay = new Map();
  const sessions = new Map();
  const recent = [];

  const now = Date.now();
  const fiveHourCutoff = now - 5 * 60 * 60 * 1000;
  const sevenDayCutoff = now - 7 * 24 * 60 * 60 * 1000;
  const window5h = {
    totals: emptyTotals(),
    byModel: new Map(),
    oldestTs: null,
    newestTs: null,
  };
  const window7d = {
    totals: emptyTotals(),
    byModel: new Map(),
    oldestTs: null,
    newestTs: null,
  };

  function addToWindow(w, usage, model, ts) {
    addUsage(w.totals, usage, model);
    if (!w.byModel.has(model)) w.byModel.set(model, emptyTotals());
    addUsage(w.byModel.get(model), usage, model);
    w.oldestTs = w.oldestTs == null ? ts : Math.min(w.oldestTs, ts);
    w.newestTs = w.newestTs == null ? ts : Math.max(w.newestTs, ts);
  }

  for (const file of files) {
    let stat;
    try {
      stat = await fs.promises.stat(file.path);
    } catch {
      continue;
    }
    if (sinceMs && stat.mtimeMs < sinceMs) continue;

    for await (const ev of readEvents(file.path)) {
      const ts = ev.timestamp ? Date.parse(ev.timestamp) : stat.mtimeMs;
      if (sinceMs && ts < sinceMs) continue;
      const model = normalizeModel(ev.model);
      const day = new Date(ts).toISOString().slice(0, 10);

      addUsage(totals, ev.usage, model);

      if (!byModel.has(model)) byModel.set(model, emptyTotals());
      addUsage(byModel.get(model), ev.usage, model);

      if (!byProject.has(file.project)) {
        byProject.set(file.project, { ...emptyTotals(), projectPath: file.projectPath });
      }
      addUsage(byProject.get(file.project), ev.usage, model);

      if (!byDay.has(day)) byDay.set(day, emptyTotals());
      addUsage(byDay.get(day), ev.usage, model);

      const sessKey = ev.sessionId || file.sessionId;
      if (!sessions.has(sessKey)) {
        sessions.set(sessKey, {
          sessionId: sessKey,
          projectPath: file.projectPath,
          firstTs: ts,
          lastTs: ts,
          ...emptyTotals(),
        });
      }
      const sess = sessions.get(sessKey);
      sess.lastTs = Math.max(sess.lastTs, ts);
      sess.firstTs = Math.min(sess.firstTs, ts);
      addUsage(sess, ev.usage, model);

      recent.push({
        ts,
        model,
        projectPath: file.projectPath,
        sessionId: sessKey,
        usage: ev.usage,
        cost: costForUsage(model, ev.usage),
      });

      if (ts >= fiveHourCutoff) addToWindow(window5h, ev.usage, model, ts);
      if (ts >= sevenDayCutoff) addToWindow(window7d, ev.usage, model, ts);
    }
  }

  recent.sort((a, b) => b.ts - a.ts);

  return {
    totals,
    byModel: mapToSortedArray(byModel, 'model'),
    byProject: mapToSortedArray(byProject, 'project'),
    byDay: Array.from(byDay.entries())
      .map(([day, t]) => ({ day, ...t }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    sessions: Array.from(sessions.values()).sort((a, b) => b.lastTs - a.lastTs),
    recent: recent.slice(0, 50),
    windows: {
      fiveHour: serializeWindow(window5h, fiveHourCutoff, 5 * 60 * 60 * 1000),
      sevenDay: serializeWindow(window7d, sevenDayCutoff, 7 * 24 * 60 * 60 * 1000),
    },
    generatedAt: Date.now(),
  };
}

function serializeWindow(w, cutoff, durationMs) {
  // Rolling reset estimate: when the oldest event in the window slides past the cutoff.
  const resetAt = w.oldestTs ? w.oldestTs + durationMs : null;
  return {
    totals: w.totals,
    byModel: mapToSortedArray(w.byModel, 'model'),
    oldestTs: w.oldestTs,
    newestTs: w.newestTs,
    cutoff,
    durationMs,
    resetAt,
  };
}

function mapToSortedArray(map, keyName) {
  return Array.from(map.entries())
    .map(([k, v]) => ({ [keyName]: k, ...v }))
    .sort((a, b) => b.cost - a.cost);
}

module.exports = { aggregate, readEvents, listSessionFiles, PROJECTS_DIR };
