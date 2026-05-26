// Unofficial claude.ai client. Uses the same session cookie a browser uses.
// Do not log or return the cookie to clients. Endpoints are not public and
// may change without notice.

const BASE = 'https://claude.ai';

function buildHeaders() {
  const h = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent':
      process.env.CLAUDE_AI_USER_AGENT ||
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    Referer: 'https://claude.ai/recents',
    Origin: 'https://claude.ai',
    'anthropic-client-platform': 'web_claude_ai',
    'anthropic-client-version': process.env.CLAUDE_AI_CLIENT_VERSION || '1.0.0',
  };
  if (process.env.CLAUDE_AI_CLIENT_SHA) h['anthropic-client-sha'] = process.env.CLAUDE_AI_CLIENT_SHA;
  if (process.env.CLAUDE_AI_DEVICE_ID) h['anthropic-device-id'] = process.env.CLAUDE_AI_DEVICE_ID;
  if (process.env.CLAUDE_AI_ANONYMOUS_ID) h['anthropic-anonymous-id'] = process.env.CLAUDE_AI_ANONYMOUS_ID;
  return h;
}

// Headers claude.ai often returns that we care about (rate limits, server time)
const INTERESTING_HEADER_PREFIXES = ['anthropic-ratelimit', 'x-ratelimit', 'retry-after'];

function config() {
  return {
    sessionKey: process.env.CLAUDE_AI_SESSION_KEY || '',
    orgId: process.env.CLAUDE_AI_ORG_ID || '',
  };
}

function pickInterestingHeaders(headers) {
  const out = {};
  headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (INTERESTING_HEADER_PREFIXES.some((p) => lk.startsWith(p))) out[lk] = v;
  });
  return out;
}

async function call(path) {
  const { sessionKey, orgId } = config();
  if (!sessionKey || !orgId) return { configured: false };

  const url = `${BASE}${path.replace('{org}', encodeURIComponent(orgId))}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { ...buildHeaders(), Cookie: `sessionKey=${sessionKey}` },
      redirect: 'manual',
    });
  } catch (err) {
    return { configured: true, error: `network: ${err.message}` };
  }

  const responseHeaders = pickInterestingHeaders(res.headers);

  if (res.status === 401 || res.status === 403) {
    return {
      configured: true,
      status: res.status,
      responseHeaders,
      error: 'sessionKey is invalid or expired — re-copy it from claude.ai cookies',
    };
  }

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      configured: true,
      status: res.status,
      responseHeaders,
      error: `non-JSON response (status ${res.status}). Cookie likely expired.`,
    };
  }
  if (!res.ok) {
    return {
      configured: true,
      status: res.status,
      responseHeaders,
      error: data?.error || text.slice(0, 300),
    };
  }
  return { configured: true, status: res.status, responseHeaders, data };
}

async function fetchOrg() {
  return call('/api/organizations/{org}');
}

async function fetchOrgs() {
  return call('/api/organizations');
}

async function fetchUsage() {
  return call('/api/organizations/{org}/usage');
}

async function fetchRateLimits() {
  return call('/api/organizations/{org}/rate_limits');
}

// Hitting any authenticated endpoint causes claude.ai to return rate-limit
// headers. chat_conversations_v2 is cheap and confirmed working.
async function probeRateLimitHeaders() {
  return call('/api/organizations/{org}/chat_conversations_v2?limit=1&offset=0&consistency=eventual');
}

// Best-effort extraction of rate-limit-ish fields from the org payload.
// claude.ai changes these often, so this is intentionally permissive.
function extractLimitInfo(org) {
  if (!org || typeof org !== 'object') return null;
  const out = {
    rateLimitTier: org.rate_limit_tier || org.subscription?.rate_limit_tier || null,
    capabilities: org.capabilities || null,
    settings: org.settings || null,
    raw: {},
  };
  for (const k of Object.keys(org)) {
    if (/rate|usage|limit|quota|reset|window/i.test(k)) {
      out.raw[k] = org[k];
    }
  }
  return out;
}

module.exports = {
  fetchOrg,
  fetchOrgs,
  fetchUsage,
  fetchRateLimits,
  probeRateLimitHeaders,
  extractLimitInfo,
};
