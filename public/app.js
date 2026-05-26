const $ = (sel) => document.querySelector(sel);

// Blacklist dossier palette — must match :root tokens in styles.css
const PALETTE = {
  void: '#07070a',
  carbon: '#101015',
  bone: '#e8e6df',
  boneDim: '#b8b6a8',
  ash: '#5d5d68',
  rule: 'rgba(232, 230, 223, 0.18)',
  ruleSoft: 'rgba(232, 230, 223, 0.10)',
  blood: '#e8341c',
  bloodDeep: '#a01b08',
  caution: '#ffc700',
  terminal: '#4cff9b',
  // legacy aliases for code paths below
  ink: '#e8e6df',
  ink2: '#b8b6a8',
  ink3: '#5d5d68',
  paper: '#07070a',
  accent: '#e8341c',
  accentDeep: '#a01b08',
  accentWarm: '#ffc700',
};

// Render today's dateline once on load
(function setDateline() {
  const el = document.getElementById('datelineDate');
  if (!el) return;
  const d = new Date();
  const fmt = d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  el.textContent = `${fmt} · ${t}`.toUpperCase();
})();

const fmt = {
  cost(n) {
    if (n == null) return '—';
    if (n < 0.01) return '$' + n.toFixed(4);
    if (n < 1) return '$' + n.toFixed(3);
    return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  },
  int(n) {
    if (n == null) return '—';
    return n.toLocaleString();
  },
  short(n) {
    if (n == null) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
  },
  time(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  },
  rel(ts) {
    if (!ts) return '—';
    const diff = Date.now() - ts;
    const s = Math.floor(diff / 1000);
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  },
};

function modelPill(model) {
  const m = (model || '').toLowerCase();
  let cls = '';
  if (m.includes('opus')) cls = 'opus';
  else if (m.includes('sonnet')) cls = 'sonnet';
  else if (m.includes('haiku')) cls = 'haiku';
  return `<span class="pill ${cls}">${model || 'unknown'}</span>`;
}

function shortenProject(p) {
  if (!p) return '—';
  return p.replace(/^\/Users\/[^/]+\//, '~/').replace(/^\/home\/[^/]+\//, '~/');
}

let dailyChart, modelChart;

function renderCharts(data) {
  const days = data.byDay || [];
  const labels = days.map((d) => d.day.slice(5));
  const costs = days.map((d) => +d.cost.toFixed(4));

  const monoFont = "'JetBrains Mono', ui-monospace, monospace";

  if (!dailyChart) {
    dailyChart = new Chart($('#dailyChart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Cost ($)',
            data: costs,
            backgroundColor: PALETTE.bone,
            hoverBackgroundColor: PALETTE.blood,
            borderRadius: 0,
            borderSkipped: false,
            barPercentage: 0.82,
            categoryPercentage: 0.9,
          },
        ],
      },
      options: chartOpts({ yMoney: true, monoFont }),
    });
  } else {
    dailyChart.data.labels = labels;
    dailyChart.data.datasets[0].data = costs;
    dailyChart.update('none');
  }

  const models = data.byModel || [];
  const mLabels = models.map((m) => m.model);
  const mCosts = models.map((m) => +m.cost.toFixed(4));
  const donutPalette = [
    PALETTE.blood,
    PALETTE.bone,
    PALETTE.caution,
    PALETTE.bloodDeep,
    PALETTE.boneDim,
    PALETTE.ash,
  ];

  if (!modelChart) {
    modelChart = new Chart($('#modelChart'), {
      type: 'doughnut',
      data: {
        labels: mLabels,
        datasets: [
          {
            data: mCosts,
            backgroundColor: donutPalette,
            borderColor: PALETTE.carbon,
            borderWidth: 2,
            hoverOffset: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: PALETTE.bone,
              font: { family: monoFont, size: 11 },
              boxWidth: 10,
              boxHeight: 10,
              padding: 12,
            },
          },
          tooltip: tooltipStyle({ moneyLabel: true, monoFont }),
        },
      },
    });
  } else {
    modelChart.data.labels = mLabels;
    modelChart.data.datasets[0].data = mCosts;
    modelChart.update('none');
  }
}

function tooltipStyle({ moneyLabel, monoFont } = {}) {
  return {
    backgroundColor: PALETTE.blood,
    titleColor: PALETTE.void,
    bodyColor: PALETTE.void,
    titleFont: { family: monoFont, size: 10, weight: 'bold' },
    bodyFont: { family: monoFont, size: 12, weight: 'bold' },
    padding: 10,
    cornerRadius: 0,
    displayColors: false,
    borderColor: PALETTE.void,
    borderWidth: 2,
    callbacks: {
      label: (ctx) => (moneyLabel ? `${ctx.label}: ${fmt.cost(ctx.parsed)}` : fmt.cost(ctx.parsed.y)),
    },
  };
}

function chartOpts({ yMoney, monoFont } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 8, right: 4, bottom: 0, left: 0 } },
    plugins: {
      legend: { display: false },
      tooltip: tooltipStyle({ moneyLabel: false, monoFont }),
    },
    scales: {
      x: {
        ticks: {
          color: PALETTE.ash,
          font: { family: monoFont, size: 10 },
          maxRotation: 0,
        },
        grid: { display: false },
        border: { color: PALETTE.rule },
      },
      y: {
        ticks: {
          color: PALETTE.ash,
          font: { family: monoFont, size: 10 },
          callback: (v) => (yMoney ? '$' + v : v),
        },
        grid: { color: PALETTE.ruleSoft, lineWidth: 1, drawTicks: false },
        border: { display: false },
      },
    },
  };
}

function renderKpis(t) {
  $('#kpiCost').textContent = fmt.cost(t.cost);
  $('#kpiRequests').textContent = `${fmt.int(t.requests)} requests`;
  $('#kpiInput').textContent = fmt.short(t.inputTokens);
  $('#kpiOutput').textContent = fmt.short(t.outputTokens);
  $('#kpiCache').textContent = `${fmt.short(t.cacheReadTokens)} / ${fmt.short(t.cacheCreateTokens)}`;
  const totalIn = t.inputTokens + t.cacheReadTokens + t.cacheCreateTokens;
  const hit = totalIn > 0 ? (t.cacheReadTokens / totalIn) * 100 : 0;
  $('#kpiCacheHit').textContent = `Hit rate ${hit.toFixed(1)}%`;
}

function renderProjects(rows) {
  const tbody = $('#projectsTable tbody');
  tbody.innerHTML = rows
    .slice(0, 12)
    .map((r) => {
      const tok = r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheCreateTokens;
      return `<tr>
        <td><span class="path" title="${r.projectPath || r.project}">${shortenProject(r.projectPath || r.project)}</span></td>
        <td class="num">${fmt.int(r.requests)}</td>
        <td class="num">${fmt.short(tok)}</td>
        <td class="num">${fmt.cost(r.cost)}</td>
      </tr>`;
    })
    .join('');
}

function renderSessions(rows) {
  const tbody = $('#sessionsTable tbody');
  tbody.innerHTML = rows
    .slice(0, 12)
    .map(
      (s) => `<tr>
        <td title="${new Date(s.lastTs).toISOString()}">${fmt.rel(s.lastTs)}</td>
        <td><span class="path" title="${s.projectPath}">${shortenProject(s.projectPath)}</span></td>
        <td class="num">${fmt.int(s.requests)}</td>
        <td class="num">${fmt.cost(s.cost)}</td>
      </tr>`
    )
    .join('');
}

let lastRecentKey = '';
function renderRecent(rows) {
  const tbody = $('#recentTable tbody');
  const newest = rows[0];
  const newestKey = newest ? `${newest.ts}-${newest.sessionId}` : '';
  const flash = newestKey && newestKey !== lastRecentKey;
  lastRecentKey = newestKey;

  tbody.innerHTML = rows
    .slice(0, 25)
    .map((r, i) => {
      const u = r.usage || {};
      return `<tr class="${i === 0 && flash ? 'flash' : ''}">
        <td title="${new Date(r.ts).toISOString()}">${fmt.time(r.ts)}</td>
        <td>${modelPill(r.model)}</td>
        <td><span class="path" title="${r.projectPath}">${shortenProject(r.projectPath)}</span></td>
        <td class="num">${fmt.short(u.input_tokens || 0)}</td>
        <td class="num">${fmt.short(u.output_tokens || 0)}</td>
        <td class="num">${fmt.short(u.cache_read_input_tokens || 0)}</td>
        <td class="num">${fmt.cost(r.cost)}</td>
      </tr>`;
    })
    .join('');
}

let lastData = null;

function render(data) {
  if (!data) return;
  lastData = data;
  renderLimits(data);
  renderKpis(data.totals);
  renderCharts(data);
  renderProjects(data.byProject);
  renderSessions(data.sessions);
  renderRecent(data.recent);
  $('#generatedAt').textContent = `Updated ${fmt.rel(data.generatedAt)}`;
}

function fmtCountdown(ms) {
  if (ms == null || ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function modelClass(model) {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'unknown';
}

function renderModelChips(containerId, byModel) {
  const el = $('#' + containerId);
  if (!byModel || byModel.length === 0) {
    el.innerHTML = '<span class="hint">No activity in this window</span>';
    return;
  }
  el.innerHTML = byModel
    .map((m) => {
      const cls = modelClass(m.model);
      return `<span class="model-chip">
        <span class="swatch ${cls}"></span>
        ${m.model}
        <span class="req-count">· ${fmt.int(m.requests)} req · ${fmt.short(m.outputTokens)} out</span>
      </span>`;
    })
    .join('');
}

function renderWindow(w, prefix) {
  if (!w) return;
  $(`#${prefix}Req`).textContent = fmt.int(w.totals.requests);
  $(`#${prefix}Out`).textContent = fmt.short(w.totals.outputTokens);
  $(`#${prefix}In`).textContent = fmt.short(w.totals.inputTokens);
  $(`#${prefix}Cache`).textContent =
    `${fmt.short(w.totals.cacheReadTokens)} / ${fmt.short(w.totals.cacheCreateTokens)}`;
  renderModelChips(`${prefix}Models`, w.byModel);
}

function severity(pct) {
  if (pct >= 90) return 'bad';
  if (pct >= 70) return 'warn';
  return '';
}

function renderPlanLimit(prefix, tier, label) {
  const pctEl = $(`#${prefix}Pct`);
  const fillEl = $(`#${prefix}Fill`);
  if (!tier || tier.utilization == null) {
    pctEl.textContent = '—';
    fillEl.style.width = '0%';
    return;
  }
  const pct = Number(tier.utilization);
  pctEl.textContent = pct.toFixed(0);
  pctEl.className = 'threat-pct ' + severity(pct);
  fillEl.style.width = Math.min(100, pct) + '%';
  fillEl.className = 'meter-fill ' + severity(pct);
}

function renderSubTiers(planLimits) {
  const el = $('#subTiers');
  if (!planLimits) {
    el.innerHTML = '';
    return;
  }
  const tiers = [
    { key: 'seven_day_opus', label: 'Opus', cls: 'opus' },
    { key: 'seven_day_sonnet', label: 'Sonnet', cls: 'sonnet' },
    { key: 'seven_day_oauth_apps', label: 'OAuth apps', cls: '' },
    { key: 'seven_day_cowork', label: 'Cowork', cls: '' },
  ];
  const parts = [];
  for (const t of tiers) {
    const v = planLimits[t.key];
    if (v == null) continue;
    const pct = v.utilization != null ? `${Number(v.utilization).toFixed(0)}%` : '—';
    parts.push(
      `<span class="sub-tier"><span class="swatch ${t.cls}"></span>${t.label} <strong>${pct}</strong></span>`
    );
  }
  const extra = planLimits.extra_usage;
  if (extra && extra.is_enabled) {
    parts.push(
      `<span class="sub-tier"><span class="swatch"></span>Extra credits <strong>${extra.utilization ?? 0}%</strong> · ${extra.used_credits ?? 0}/${extra.monthly_limit ?? '?'} ${extra.currency || ''}</span>`
    );
  }
  el.innerHTML = parts.join('');
}

function renderLimits(data) {
  const w5 = data.windows?.fiveHour;
  const w7 = data.windows?.sevenDay;
  renderWindow(w5, 'fiveHour');
  renderWindow(w7, 'sevenDay');
  renderPlanLimit('fiveHour', data.planLimits?.five_hour);
  renderPlanLimit('sevenDay', data.planLimits?.seven_day);
  renderSubTiers(data.planLimits);
  updateResets();
}

function updateResets() {
  if (!lastData) return;
  const plan = lastData.planLimits;
  if (plan?.five_hour?.resets_at) {
    const ms = Date.parse(plan.five_hour.resets_at) - Date.now();
    $('#fiveHourReset').innerHTML =
      `Resets in <strong>${fmtCountdown(ms)}</strong> · ${new Date(plan.five_hour.resets_at).toLocaleTimeString()}`;
  } else {
    $('#fiveHourReset').textContent = plan?.error ? `claude.ai: ${plan.error}` : '—';
  }
  if (plan?.seven_day?.resets_at) {
    const ms = Date.parse(plan.seven_day.resets_at) - Date.now();
    $('#sevenDayReset').innerHTML =
      `Resets in <strong>${fmtCountdown(ms)}</strong> · ${new Date(plan.seven_day.resets_at).toLocaleDateString()} ${new Date(plan.seven_day.resets_at).toLocaleTimeString()}`;
  } else {
    $('#sevenDayReset').textContent = plan?.error ? `claude.ai: ${plan.error}` : '—';
  }
}

async function loadLocal() {
  const res = await fetch('/api/usage/local');
  const data = await res.json();
  render(data);
}

async function loadClaudeAi() {
  const res = await fetch('/api/usage/claude-ai');
  const result = await res.json();
  if (!result.configured) return;
  const panel = $('#claudeAiPanel');
  panel.hidden = false;

  const status = $('#claudeAiStatus');
  if (result.error) {
    status.textContent = `Error: ${result.error}`;
    $('#claudeAiSummary').innerHTML = '';
    $('#claudeAiRaw').textContent = JSON.stringify(result, null, 2);
    return;
  }
  status.textContent = `OK · status ${result.status}`;
  $('#claudeAiSummary').innerHTML = renderClaudeAiSummary(result);
  $('#claudeAiRaw').textContent = JSON.stringify(result, null, 2);
}

function renderClaudeAiSummary(result) {
  const d = result.data || {};
  const info = result.limitInfo || {};
  const rows = [];

  if (info.rateLimitTier)
    rows.push(`<div class="metric"><div class="m-label">Rate limit tier</div><div class="m-value">${info.rateLimitTier}</div></div>`);
  if (d.name)
    rows.push(`<div class="metric"><div class="m-label">Org name</div><div class="m-value">${d.name}</div></div>`);

  // Surface any rate-limit-ish headers claude.ai returned
  const hdrs = result.responseHeaders || {};
  for (const [k, v] of Object.entries(hdrs)) {
    rows.push(`<div class="metric"><div class="m-label">${k}</div><div class="m-value">${v}</div></div>`);
  }

  // Any field on the org payload that smells like rate/usage/limit
  for (const [k, v] of Object.entries(info.raw || {})) {
    const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
    rows.push(`<div class="metric"><div class="m-label">${k}</div><div class="m-value">${val}</div></div>`);
  }

  if (rows.length === 0)
    return '<p class="hint">No obvious rate-limit fields in the org response. See raw JSON below — tell me which field shows your usage and I\'ll render it.</p>';

  return `<div class="metric-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">${rows.join('')}</div>`;
}

async function loadApi() {
  const res = await fetch('/api/usage/api');
  const result = await res.json();
  if (!result.configured) return;
  $('#apiPanel').hidden = false;
  if (result.error) {
    $('#apiStatus').textContent = result.error;
    $('#apiRaw').textContent = '';
    return;
  }
  $('#apiStatus').textContent = 'OK';
  $('#apiRaw').textContent = JSON.stringify(result.data, null, 2);
}

let lastEventAt = Date.now();
function setLive(state) {
  const dot = $('#liveDot');
  const label = $('#liveLabel');
  if (!dot) return;
  dot.classList.remove('stale', 'off');
  if (state === 'stale') dot.classList.add('stale');
  if (state === 'off') dot.classList.add('off');
  if (label) label.textContent = state === 'off' ? 'offline' : state === 'stale' ? 'idle' : 'live';
}

function connectStream() {
  const es = new EventSource('/api/stream');
  setLive('live');

  es.addEventListener('usage', (e) => {
    lastEventAt = Date.now();
    try {
      render(JSON.parse(e.data));
    } catch (err) {
      console.error(err);
    }
  });
  es.addEventListener('limits', (e) => {
    lastEventAt = Date.now();
    try {
      const limits = JSON.parse(e.data);
      if (lastData) {
        lastData.planLimits = limits;
        renderPlanLimit('fiveHour', limits.five_hour);
        renderPlanLimit('sevenDay', limits.seven_day);
        renderSubTiers(limits);
        updateResets();
      }
    } catch (err) {
      console.error(err);
    }
  });
  es.addEventListener('ping', () => {
    lastEventAt = Date.now();
    setLive('live');
  });
  es.onerror = () => setLive('off');
}

setInterval(() => {
  $('#generatedAt').textContent = fmt.rel(lastEventAt);
  updateResets();
  const dot = $('#liveDot');
  if (
    Date.now() - lastEventAt > 60_000 &&
    !dot.classList.contains('stale') &&
    !dot.classList.contains('off')
  ) {
    setLive('stale');
  }
}, 1_000);

$('#refreshBtn').addEventListener('click', () => {
  loadLocal();
  loadApi();
  loadClaudeAi();
});

loadLocal();
loadApi();
loadClaudeAi();
connectStream();
