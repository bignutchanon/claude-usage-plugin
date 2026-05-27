// Slack notification module for Claude Usage Monitor
// Supports: usage threshold alerts, rate limit alerts, daily summaries

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const CHANNEL = process.env.SLACK_CHANNEL || '#claude-usage';

// Thresholds for usage alerts (percentage)
const THRESHOLDS = (process.env.SLACK_THRESHOLDS || '80,90,95')
  .split(',')
  .map((n) => parseInt(n.trim(), 10))
  .filter((n) => n > 0 && n <= 100);

// Daily summary time (24h format, e.g., "09:00")
const DAILY_SUMMARY_TIME = process.env.SLACK_DAILY_SUMMARY_TIME || '09:00';

// Track which thresholds have been alerted to avoid spam
const alertedThresholds = new Map();

function isConfigured() {
  return !!WEBHOOK_URL;
}

async function send(payload) {
  if (!WEBHOOK_URL) return { ok: false, error: 'SLACK_WEBHOOK_URL not configured' };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Slack returned ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function formatNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms) {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function sendUsageThresholdAlert({ usagePercent, used, limit, resetAt, model }) {
  const emoji = usagePercent >= 95 ? ':rotating_light:' : usagePercent >= 90 ? ':warning:' : ':chart_with_upwards_trend:';
  const color = usagePercent >= 95 ? '#ff0000' : usagePercent >= 90 ? '#ff9900' : '#ffcc00';

  const timeUntilReset = resetAt ? formatDuration(new Date(resetAt) - Date.now()) : 'unknown';

  const payload = {
    channel: CHANNEL,
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${emoji} Claude Usage Alert: ${usagePercent}%`,
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Model:*\n${model || 'Unknown'}` },
              { type: 'mrkdwn', text: `*Usage:*\n${formatNumber(used)} / ${formatNumber(limit)}` },
              { type: 'mrkdwn', text: `*Percent:*\n${usagePercent}%` },
              { type: 'mrkdwn', text: `*Resets in:*\n${timeUntilReset}` },
            ],
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `Triggered at ${new Date().toISOString()}` },
            ],
          },
        ],
      },
    ],
  };

  return send(payload);
}

async function sendRateLimitAlert({ model, retryAfter, endpoint }) {
  const payload = {
    channel: CHANNEL,
    attachments: [
      {
        color: '#ff0000',
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: ':no_entry: Rate Limit Hit!',
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Model:*\n${model || 'Unknown'}` },
              { type: 'mrkdwn', text: `*Retry After:*\n${retryAfter || 'Unknown'}` },
              { type: 'mrkdwn', text: `*Endpoint:*\n${endpoint || 'N/A'}` },
            ],
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `Triggered at ${new Date().toISOString()}` },
            ],
          },
        ],
      },
    ],
  };

  return send(payload);
}

async function sendDailySummary({ usage, costs, topProjects, planLimits }) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: ':bar_chart: Daily Claude Usage Summary',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${today}*` },
    },
  ];

  // Usage stats
  if (usage) {
    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Total Tokens:*\n${formatNumber(usage.totalTokens || 0)}` },
        { type: 'mrkdwn', text: `*Sessions:*\n${usage.sessions || 0}` },
        { type: 'mrkdwn', text: `*Input:*\n${formatNumber(usage.inputTokens || 0)}` },
        { type: 'mrkdwn', text: `*Output:*\n${formatNumber(usage.outputTokens || 0)}` },
      ],
    });
  }

  // Costs
  if (costs && costs.total > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Estimated Cost:* $${costs.total.toFixed(2)}`,
      },
    });
  }

  // Plan limits
  if (planLimits && planLimits.usagePercent) {
    const bar = '█'.repeat(Math.floor(planLimits.usagePercent / 10)) +
                '░'.repeat(10 - Math.floor(planLimits.usagePercent / 10));
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Plan Usage:* [${bar}] ${planLimits.usagePercent}%`,
      },
    });
  }

  // Top projects
  if (topProjects && topProjects.length > 0) {
    const projectList = topProjects
      .slice(0, 5)
      .map((p, i) => `${i + 1}. ${p.name}: ${formatNumber(p.tokens)} tokens`)
      .join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Top Projects:*\n${projectList}` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: 'Claude Usage Monitor • Auto-generated daily summary' },
    ],
  });

  const payload = {
    channel: CHANNEL,
    attachments: [{ color: '#7c3aed', blocks }],
  };

  return send(payload);
}

function checkThreshold(usagePercent, resetKey) {
  const triggeredThresholds = [];

  for (const threshold of THRESHOLDS) {
    const alertKey = `${resetKey}-${threshold}`;
    if (usagePercent >= threshold && !alertedThresholds.has(alertKey)) {
      alertedThresholds.set(alertKey, Date.now());
      triggeredThresholds.push(threshold);
    }
  }

  return triggeredThresholds;
}

function resetThresholds(resetKey) {
  for (const key of alertedThresholds.keys()) {
    if (key.startsWith(resetKey)) {
      alertedThresholds.delete(key);
    }
  }
}

function shouldSendDailySummary() {
  const now = new Date();
  const [targetHour, targetMinute] = DAILY_SUMMARY_TIME.split(':').map(Number);
  return now.getHours() === targetHour && now.getMinutes() === targetMinute;
}

module.exports = {
  isConfigured,
  send,
  sendUsageThresholdAlert,
  sendRateLimitAlert,
  sendDailySummary,
  checkThreshold,
  resetThresholds,
  shouldSendDailySummary,
  THRESHOLDS,
  DAILY_SUMMARY_TIME,
};
