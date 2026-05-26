#!/usr/bin/env node

// SwiftBar streamable plugin — Claude usage menu-bar widget.
//
// Subscribes to the dashboard's SSE channel (/api/stream) so the widget
// updates the *instant* the dashboard does. No polling, no drift between
// widget and dashboard.
//
// SwiftBar reads stdout and replaces the menu on every "~~~" delimiter line.

// ── CONFIG ───────────────────────────────────────────────────────────────────
const BASE = process.env.CLAUDE_MONITOR_BASE || 'http://localhost:4000';
const PROJECT_DIR = '/Users/chanonsangpat/Projects/claude-usage-monitor';
const LAUNCHD_LABEL = 'com.chanonsangpat.claude-usage-monitor';
const SERVER_LOG = '/Users/chanonsangpat/Library/Logs/claude-usage-monitor.log';
const HOSTNAME = 'claude-rig';
const USER = 'root';
const UID = process.getuid?.() ?? 501;
const LAUNCHD_TARGET = `gui/${UID}/${LAUNCHD_LABEL}`;

const TICK_MS = 5_000;          // re-render every 5s for countdown ticking
const RECONNECT_MS = 2_000;     // SSE reconnect backoff
const INIT_TIMEOUT_MS = 8_000;  // initial fetch timeout

const COLOR = {
  ok: '#00ff41', warn: '#ff9500', bad: '#ff003c',
  dim: '#2d6b2d', ash: '#6fa66f', bone: '#9eff9e', cyan: '#00e0ff',
};
const FONT = 'JetBrainsMono-Regular,Menlo';
const FONT_BOLD = 'JetBrainsMono-Bold,Menlo-Bold';
const ANTHROPIC_ICON =
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAYUlEQVR42rWUwQ4AIAhC/f+fpquXIDTcOrS1N8SkShfaGRcEEC6sA9TdgjLgqk247UMogVBuQ+HCGFjBn5TdzAfxGkwRg8v3E0g5Xq49jEw59g+/bUpkl+Np8y0PI4k9rgOFf7NN5z/SkgAAAABJRU5ErkJggg==';

// ── PRIMITIVES ───────────────────────────────────────────────────────────────
const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function severityColor(pct) {
  if (pct == null || Number.isNaN(pct)) return COLOR.dim;
  if (pct >= 80) return COLOR.bad;
  if (pct >= 50) return COLOR.warn;
  return COLOR.ok;
}

function crtBar(pct, width) {
  if (pct == null || Number.isNaN(pct)) return '░'.repeat(width);
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

const hex = (n) =>
  n == null || Number.isNaN(n)
    ? '0x--'
    : '0x' + Math.round(n).toString(16).toUpperCase().padStart(2, '0');

function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function fmtMoney(n) {
  if (n == null) return '$--';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + n.toFixed(0);
  return '$' + n.toFixed(2);
}

function fmtResetIn(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'T-00:00:00';
  const total = (ms / 1000) | 0;
  const d = (total / 86400) | 0;
  const h = ((total % 86400) / 3600) | 0;
  const m = ((total % 3600) / 60) | 0;
  const s = total % 60;
  return d > 0
    ? `T-${d}d ${pad2(h)}:${pad2(m)}:${pad2(s)}`
    : `T-${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function fmtClock(ts) {
  const d = ts ? new Date(ts) : new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

const pickPct = (tier) =>
  tier && tier.utilization != null ? Number(tier.utilization) : null;

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function getJSON(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ── LINE BUILDERS ────────────────────────────────────────────────────────────
function line(text, attrs) {
  if (!attrs) return text;
  let out = text;
  let sep = ' | ';
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === '') continue;
    out += sep + k + '=' + v;
    sep = ' ';
  }
  return out;
}

function mono(text, color, size, bold, extras) {
  const attrs = { color, size, font: bold ? FONT_BOLD : FONT };
  if (extras) Object.assign(attrs, extras);
  return line(text, attrs);
}

const sub = (text, attrs) => '--' + line(text, attrs);

const launchctlAttrs = (signal) =>
  signal === 'kill'
    ? { bash: 'launchctl', param1: 'kill', param2: 'TERM', param3: LAUNCHD_TARGET, terminal: 'false', refresh: 'true' }
    : { bash: 'launchctl', param1: 'kickstart', param2: '-k', param3: LAUNCHD_TARGET, terminal: 'false', refresh: 'true' };

const tailLogAttrs = {
  shell: 'osascript',
  param1: '-e',
  param2: `'tell application "Terminal" to do script "tail -f ${SERVER_LOG}"'`,
  terminal: 'false',
};

// ── RENDER (pure functions of state) ─────────────────────────────────────────
function topbar(limits) {
  const fh = pickPct(limits?.five_hour);
  const sd = pickPct(limits?.seven_day);
  const hasData = fh != null || sd != null;
  const color = hasData ? severityColor(Math.max(fh ?? 0, sd ?? 0)) : COLOR.dim;
  const fhTxt = fh == null ? '--' : pad2(Math.round(fh));
  const sdTxt = sd == null ? '--' : pad2(Math.round(sd));
  return line(`5h:${fhTxt}% 7d:${sdTxt}%`, {
    templateImage: ANTHROPIC_ICON, color, font: FONT_BOLD, size: 12,
  });
}

const sectionHead = (num, name) =>
  mono(`[${num}] >> ${name}`, COLOR.cyan, 11, true);

function renderBanner(limits, connected) {
  let mark, text, color;
  if (!connected) { mark = '[~]'; text = 'STREAM RECONNECTING'; color = COLOR.warn; }
  else if (limits?.error) { mark = '[!]'; text = 'LINK DEGRADED'; color = COLOR.warn; }
  else { mark = '[+]'; text = 'LINK ESTABLISHED'; color = COLOR.ok; }
  return [
    mono(`${USER}@${HOSTNAME}:~# claude --stream`, COLOR.dim, 10),
    mono(`${mark} ${text}`, color, 11, true),
    mono('    target  : nuthappy2549@gmail.com', COLOR.ash, 10),
    mono('    host    : claude.ai', COLOR.ash, 10),
    mono('    tier    : default_claude_max_5x', COLOR.ash, 10),
    mono(`    sock    : ${BASE.replace(/^https?:\/\//, '')}`, COLOR.ash, 10),
  ];
}

function renderLimitBlock(kicker, tier) {
  const pct = pickPct(tier);
  const pctTxt = pct == null ? '---' : String(Math.round(pct)).padStart(3, ' ');
  const reset = fmtResetIn(tier?.resets_at);
  const out = [
    mono(`  > ${kicker}`, COLOR.bone, 11, true),
    mono(`    [${crtBar(pct, 16)}] ${pctTxt}%  ${hex(pct)}`, severityColor(pct), 13, true),
  ];
  if (reset) out.push(mono(`    └─ ${reset}  // window_reset`, COLOR.ash, 10));
  return out;
}

function renderSubTier(name, tier) {
  const pct = pickPct(tier);
  if (pct == null) return null;
  return mono(
    `    └─ ${name.padEnd(7)} [${crtBar(pct, 10)}] ${String(Math.round(pct)).padStart(3)}%`,
    severityColor(pct), 10,
  );
}

function renderPayloadLog(usage) {
  const t = usage?.totals;
  if (!t) return [mono('    [!] no payload data', COLOR.dim, 11)];
  const rows = [
    ['cost', fmtMoney(t.cost), true],
    ['requests', fmtNum(t.requests), false],
    ['tokens.in', fmtNum(t.inputTokens), false],
    ['tokens.out', fmtNum(t.outputTokens), false],
    ['cache.read', fmtNum(t.cacheReadTokens), false],
    ['cache.write', fmtNum(t.cacheCreateTokens), false],
  ];
  return rows.map(([k, v, accent]) =>
    mono(
      `    ${('$ ' + k).padEnd(14)} ${v.padStart(12)}`,
      accent ? COLOR.bone : COLOR.ash, 11, accent,
    ),
  );
}

function renderProcStats(usage) {
  const byModel = usage?.byModel;
  if (!Array.isArray(byModel)) return [];
  const entries = byModel
    .filter((m) => m.model && m.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 4);
  if (!entries.length) return [];
  const totalCost = entries.reduce((s, e) => s + e.cost, 0) || 1;
  return entries.map((e, i) => {
    const pct = (e.cost / totalCost) * 100;
    const name = e.model.replace(/^claude-/, '').slice(0, 18).padEnd(18);
    return mono(
      `    [${i}] ${name} [${crtBar(pct, 10)}] ${fmtMoney(e.cost).padStart(8)}`,
      severityColor(pct), 10,
    );
  });
}

function renderExec(limits) {
  const out = [
    mono('  $ open dashboard', COLOR.bone, 11, true, {
      href: BASE, sfimage: 'arrow.up.right.square.fill',
    }),
    mono('  $ refresh --now', COLOR.bone, 11, true, {
      refresh: 'true', sfimage: 'arrow.clockwise',
    }),
    mono('  $ service --ctl', COLOR.bone, 11, true, { sfimage: 'gearshape.fill' }),
    sub('tail -f log', tailLogAttrs),
    sub('open log in Console.app', {
      shell: 'open', param1: '-a', param2: 'Console', param3: SERVER_LOG, terminal: 'false',
    }),
    sub('systemctl restart claude-usage', launchctlAttrs('restart')),
    sub('kill -TERM daemon', launchctlAttrs('kill')),
    sub('open workspace', { href: `file://${PROJECT_DIR}` }),
  ];
  if (limits?.error) out.push(mono(`  [!] claude.ai: ${limits.error}`, COLOR.warn, 9));
  return out;
}

function buildOnlineFrame(state) {
  const { limits, usage, connected, lastEventAt } = state;
  const out = [
    topbar(limits),
    '---',
    ...renderBanner(limits, connected),
    '---',
    sectionHead('01', 'RATE_LIMITS'),
    ...renderLimitBlock('5H_WINDOW', limits?.five_hour),
    ...renderLimitBlock('7D_WINDOW', limits?.seven_day),
  ];
  const opus = renderSubTier('opus', limits?.seven_day_opus);
  if (opus) out.push(opus);
  const sonnet = renderSubTier('sonnet', limits?.seven_day_sonnet);
  if (sonnet) out.push(sonnet);

  out.push(
    '---',
    sectionHead('02', 'PAYLOAD_LOG // lifetime'),
    ...renderPayloadLog(usage),
  );

  const proc = renderProcStats(usage);
  if (proc.length) {
    out.push('---', sectionHead('03', 'PROC_STATS // cost_share'), ...proc);
  }

  out.push('---', sectionHead('04', 'EXEC'), ...renderExec(limits));

  const ev = lastEventAt ? fmtClock(lastEventAt) : '--:--:--';
  out.push(
    '---',
    mono(`// last_event=${ev}  mode=stream/sse`, COLOR.dim, 9),
    mono(`// ${USER}@${HOSTNAME} :: ${fmtClock()}`, COLOR.dim, 9),
  );
  return out.join('\n');
}

function buildOfflineFrame(err) {
  const out = [
    line('OFFLINE', {
      sfimage: 'bolt.slash.fill', color: COLOR.bad, font: FONT_BOLD, size: 13,
    }),
    '---',
    mono(`${USER}@${HOSTNAME}:~# claude --stream`, COLOR.dim, 10),
    mono('[!] CONNECTION REFUSED', COLOR.bad, 12, true),
    mono('    daemon  : down', COLOR.ash, 10),
    mono(`    target  : ${BASE}`, COLOR.ash, 10),
  ];
  if (err) out.push(mono(`    error   : ${err}`, COLOR.ash, 10));
  out.push(
    '---',
    sectionHead('00', 'RECOVERY'),
    mono('  $ systemctl start claude-usage', COLOR.bone, 11, true, {
      ...launchctlAttrs('restart'), sfimage: 'play.fill',
    }),
    mono('  $ tail -f log', COLOR.bone, 11, true, {
      ...tailLogAttrs, sfimage: 'doc.text.magnifyingglass',
    }),
    mono('  $ cd ~/Projects/claude-usage-monitor', COLOR.bone, 11, true, {
      href: `file://${PROJECT_DIR}`, sfimage: 'folder.fill',
    }),
    mono('  $ refresh', COLOR.bone, 11, true, {
      refresh: 'true', sfimage: 'arrow.clockwise',
    }),
  );
  return out.join('\n');
}

// ── STREAM ENGINE ────────────────────────────────────────────────────────────
const state = {
  limits: null,
  usage: null,
  connected: false,
  lastEventAt: null,
  lastError: null,
};

function emit() {
  const frame = state.limits || state.usage
    ? buildOnlineFrame(state)
    : buildOfflineFrame(state.lastError);
  // SwiftBar's stream delimiter — must be on its own line.
  process.stdout.write(frame + '\n~~~\n');
}

async function fetchInitialSnapshot() {
  try {
    const [limits, usage] = await Promise.all([
      getJSON(`${BASE}/api/limits`, INIT_TIMEOUT_MS),
      getJSON(`${BASE}/api/usage/local`, INIT_TIMEOUT_MS).catch(() => null),
    ]);
    state.limits = limits;
    state.usage = usage;
    state.lastEventAt = Date.now();
    state.lastError = null;
    return true;
  } catch (err) {
    state.lastError = err.message;
    return false;
  }
}

function parseSSEMessage(msg) {
  // Each event is "event: <name>\ndata: <json>".  Lines may also start with
  // "retry:" or ":" (comment) — ignore those.
  let event = 'message';
  let dataStr = '';
  for (const ln of msg.split('\n')) {
    if (ln.startsWith('event: ')) event = ln.slice(7).trim();
    else if (ln.startsWith('data: ')) dataStr += ln.slice(6);
  }
  if (!dataStr) return null;
  try {
    return { event, data: JSON.parse(dataStr) };
  } catch {
    return null;
  }
}

async function streamLoop() {
  while (true) {
    let res;
    try {
      res = await fetch(`${BASE}/api/stream`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      state.connected = true;
      state.lastError = null;
      emit();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const msg = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const parsed = parseSSEMessage(msg);
          if (!parsed) continue;
          state.lastEventAt = Date.now();
          if (parsed.event === 'limits') { state.limits = parsed.data; emit(); }
          else if (parsed.event === 'usage') { state.usage = parsed.data; emit(); }
          // 'ping' events bump lastEventAt only — no re-render needed (the
          // tick timer handles countdown ticking).
        }
      }
    } catch (err) {
      state.lastError = err.message;
    }
    // disconnected
    state.connected = false;
    emit();
    await sleep(RECONNECT_MS);
  }
}

function tickLoop() {
  // Keep countdowns + clock fresh even when no SSE event arrives.
  setInterval(emit, TICK_MS).unref?.();
}

// Graceful shutdown so SwiftBar's process recycling stays clean.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => process.exit(0));
}

(async () => {
  // Emit a placeholder frame immediately so SwiftBar sees output within ms
  // and doesn't think we're stuck. Otherwise it can spawn a second instance.
  state.lastError = 'booting…';
  emit();
  await fetchInitialSnapshot();
  emit();
  tickLoop();
  await streamLoop();
})().catch((err) => {
  state.lastError = String(err.message || err);
  emit();
  process.exit(1);
});
