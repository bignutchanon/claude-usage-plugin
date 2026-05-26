// Anthropic Admin API client for org-wide usage.
// Requires an Admin API key (sk-ant-admin01-...). Set ANTHROPIC_ADMIN_KEY in .env.
// Docs: https://docs.claude.com/en/api/admin-api/usage-cost/get-messages-usage-report

const BASE = 'https://api.anthropic.com';

async function fetchMessagesUsage({ startDate, endDate, bucketWidth = '1d' } = {}) {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) return { configured: false };

  const now = new Date();
  const end = endDate || now.toISOString();
  const start =
    startDate || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const url = new URL('/v1/organizations/usage_report/messages', BASE);
  url.searchParams.set('starting_at', start);
  url.searchParams.set('ending_at', end);
  url.searchParams.set('bucket_width', bucketWidth);

  const res = await fetch(url, {
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      configured: true,
      error: `Anthropic API ${res.status}: ${text.slice(0, 300)}`,
    };
  }

  const data = await res.json();
  return { configured: true, data };
}

module.exports = { fetchMessagesUsage };
